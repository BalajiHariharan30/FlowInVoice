import { StateGraph, START, END } from "@langchain/langgraph";
import { v4 as uuidv4 } from "uuid";
import { WorkflowStateAnnotation, WorkflowState } from "./state.js";
import { createExtractionNode } from "./extraction/extraction.agent.js";
import { createMatchingNode } from "./matching/matching.agent.js";
import { createPOValidationNode } from "./po/po.agent.js";
import { createPolicyEvaluationNode } from "./policy/policy.agent.js";
import { createApprovalDecisionNode } from "./approval/approval.agent.js";
import { createExceptionNode } from "./exception/exception.agent.js";
import { createPostingNode } from "./posting/posting.agent.js";
import {
  PurchaseOrderRepository,
  AuditRepository
} from "../../repositories/index.js";
import { logger } from "../../utils/logger.js";

export interface WorkflowExecutionResult {
  poId: string;
  workflowId: string;
  status: string;
  isBusinessException: boolean;
  invoiceId?: string;
  invoiceNumber?: string;
  reviewId?: string;
  erpPostingId?: string;
  validationErrors: string[];
  currentStep: string;
}

/**
 * Builds and compiles the 7-agent LangGraph workflow for a specific tenant.
 * Tools and repositories are strictly closure-bound to the authenticated tenantId.
 */
export function buildOrchestrationGraph(tenantId: string) {
  const extractionNode = createExtractionNode(tenantId);
  const matchingNode = createMatchingNode(tenantId);
  const poValidationNode = createPOValidationNode(tenantId);
  const policyEvaluationNode = createPolicyEvaluationNode(tenantId);
  const approvalDecisionNode = createApprovalDecisionNode(tenantId);
  const exceptionNode = createExceptionNode(tenantId);
  const postingNode = createPostingNode(tenantId);

  // Router 1: Extraction -> Matching or Exception
  const shouldContinueAfterExtraction = (state: WorkflowState): "matching" | "exception" => {
    if (
      state.technicalError ||
      !state.extractedData ||
      (state.extractedData.confidence ?? 1.0) < 0.75
    ) {
      logger.info({ poId: state.poId }, "Router: Routing from Extraction to Exception");
      return "exception";
    }
    return "matching";
  };

  // Router 2: PO Validation -> Policy or Exception
  const shouldContinueAfterPOValidation = (state: WorkflowState): "policyEvaluation" | "exception" => {
    if (
      (state.validationErrors && state.validationErrors.length > 0) ||
      state.isBusinessException
    ) {
      logger.info({ poId: state.poId }, "Router: Routing from PO Validation to Exception");
      return "exception";
    }
    return "policyEvaluation";
  };

  // Router 3: Approval Decision -> Posting or Exception
  const shouldContinueAfterApproval = (state: WorkflowState): "posting" | "exception" => {
    if (state.approvalRequired || state.isBusinessException) {
      logger.info({ poId: state.poId }, "Router: Routing from Approval Decision to Exception");
      return "exception";
    }
    return "posting";
  };

  const workflow = new StateGraph(WorkflowStateAnnotation)
    .addNode("extraction", extractionNode)
    .addNode("matching", matchingNode)
    .addNode("poValidation", poValidationNode)
    .addNode("policyEvaluation", policyEvaluationNode)
    .addNode("approvalDecision", approvalDecisionNode)
    .addNode("exception", exceptionNode)
    .addNode("posting", postingNode)

    .addEdge(START, "extraction")
    .addConditionalEdges("extraction", shouldContinueAfterExtraction, {
      matching: "matching",
      exception: "exception"
    })
    .addEdge("matching", "poValidation")
    .addConditionalEdges("poValidation", shouldContinueAfterPOValidation, {
      policyEvaluation: "policyEvaluation",
      exception: "exception"
    })
    .addEdge("policyEvaluation", "approvalDecision")
    .addConditionalEdges("approvalDecision", shouldContinueAfterApproval, {
      posting: "posting",
      exception: "exception"
    })
    .addEdge("posting", END)
    .addEdge("exception", END);

  return workflow.compile();
}

export interface StepUpdateEvent {
  step: string;
  status: string;
  isBusinessException?: boolean;
  details?: Record<string, any>;
  timestamp: string;
}

export interface WorkflowExecutionOptions {
  timeoutMs?: number;
  onStepUpdate?: (event: StepUpdateEvent) => void;
}

/**
 * Main execution runner for the LangGraph Orchestration Workflow.
 * Enforces a hard wall-clock timeout (default 30s) via Promise.race.
 * Streams intermediate node updates when onStepUpdate callback is provided.
 */
export async function runOrchestrationWorkflow(
  tenantId: string,
  poId: string,
  options?: WorkflowExecutionOptions
): Promise<WorkflowExecutionResult> {
  const po = await PurchaseOrderRepository.findById(tenantId, poId);
  if (!po) {
    throw new Error(`PO not found: ${poId}`);
  }

  const workflowId = po.workflowId || `wf_${uuidv4()}`;
  if (!po.workflowId) {
    await PurchaseOrderRepository.updateExtraction(tenantId, poId, { workflowId });
  }

  const graph = buildOrchestrationGraph(tenantId);

  const timeoutMs = options?.timeoutMs || 30000; // 30s default (§0.6)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () =>
        reject(
          new Error("Workflow orchestration timed out. Operation exceeded 30s limit.")
        ),
      timeoutMs
    ).unref();
  });

  const executionPromise = (async (): Promise<WorkflowExecutionResult> => {
    try {
      const initialState = {
        tenantId,
        poId,
        workflowId,
        documentName: po.documentName,
        s3Key: po.s3Key,
        currentStep: "intake",
        status: "PROCESSING",
        toolCallCount: 0,
        validationChecks: [],
        validationErrors: [],
        evidence: [],
        policySourceReferences: [],
        matchedLineItems: [],
        approvalRequired: false,
        isBusinessException: false,
        allowedVariancePct: 10.0,
        stepRetries: {}
      };

      if (options?.onStepUpdate) {
        options.onStepUpdate({
          step: "intake",
          status: "PROCESSING",
          details: { poId, workflowId },
          timestamp: new Date().toISOString()
        });
      }

      let finalState = initialState as unknown as WorkflowState;
      const stream = await graph.stream(initialState, { streamMode: "values" });
      for await (const stateChunk of stream) {
        finalState = stateChunk as WorkflowState;
        if (options?.onStepUpdate && finalState.currentStep && finalState.currentStep !== "intake") {
          options.onStepUpdate({
            step: finalState.currentStep,
            status: finalState.status,
            isBusinessException: Boolean(finalState.isBusinessException),
            details: {
              validationErrorsCount: finalState.validationErrors?.length || 0,
              evidenceCount: finalState.evidence?.length || 0,
              invoiceNumber: finalState.invoiceNumber,
              reviewId: finalState.reviewId,
              erpPostingId: finalState.erpPostingId
            },
            timestamp: new Date().toISOString()
          });
        }
      }

      return {
        poId,
        workflowId,
        status: finalState.status || "COMPLETED",
        isBusinessException: Boolean(finalState.isBusinessException),
        invoiceId: finalState.invoiceId,
        invoiceNumber: finalState.invoiceNumber,
        reviewId: finalState.reviewId,
        erpPostingId: finalState.erpPostingId,
        validationErrors: finalState.validationErrors || [],
        currentStep: finalState.currentStep || "completed"
      };
    } catch (err: any) {
      logger.error({ err, tenantId, poId }, "Error during LangGraph orchestration execution");
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "FAILED", err.message);
      await AuditRepository.create(tenantId, {
        agentName: "SupervisorAgent",
        action: "WORKFLOW_EXECUTION_FAILED",
        status: "FAILURE",
        entityId: poId,
        workflowId,
        summary: `Orchestration workflow execution failed: ${err.message}`
      });
      throw err;
    }
  })();

  return Promise.race([executionPromise, timeoutPromise]);
}
