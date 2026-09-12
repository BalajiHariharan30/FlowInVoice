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
import { MongoCheckpointSaver } from "./checkpoint.service.js";
import {
  PurchaseOrderRepository,
  AuditRepository,
  ReviewRepository,
  InvoiceRepository,
  reconcileTaxFromLineItems
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
  noActiveContract?: boolean;
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

  // Router from START: On approval / resume from exception, proceed directly to posting node
  const shouldStartAt = (state: WorkflowState): "extraction" | "posting" => {
    if (state.isHumanApproved || state.resumedFromStep === "posting") {
      logger.info(
        { poId: state.poId, resumedFromStep: state.resumedFromStep },
        "Router: Resuming execution directly at Posting node (bypassing completed extraction/matching)"
      );
      return "posting";
    }
    return "extraction";
  };

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
      logger.info({ poId: state.poId, errors: state.validationErrors }, "Router: Routing from PO Validation to Exception");
      return "exception";
    }
    if (state.isHumanApproved || state.skipValidation) {
      return "policyEvaluation";
    }
    return "policyEvaluation";
  };

  // Router 3: Approval Decision -> Posting or Exception
  const shouldContinueAfterApproval = (state: WorkflowState): "posting" | "exception" => {
    if (
      (state.validationErrors && state.validationErrors.length > 0) ||
      state.isBusinessException
    ) {
      logger.info({ poId: state.poId, errors: state.validationErrors }, "Router: Routing from Approval Decision to Exception");
      return "exception";
    }
    if (state.isHumanApproved) {
      return "posting";
    }
    if (state.approvalRequired) {
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

    .addConditionalEdges(START, shouldStartAt, {
      extraction: "extraction",
      posting: "posting"
    })
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

  const checkpointer = new MongoCheckpointSaver(tenantId);
  return workflow.compile({ checkpointer });
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

  // Rule 1: Terminal status check on PO
  if (po.status === "REJECTED") {
    logger.info({ tenantId, poId }, "runOrchestrationWorkflow: PO is in terminal REJECTED status; execution aborted");
    return {
      poId,
      workflowId,
      status: "REJECTED",
      isBusinessException: true,
      validationErrors: [po.failureReason || po.terminationReason || "PO is rejected"],
      currentStep: "terminated"
    };
  }

  if (po.status === "DELETED") {
    logger.info({ tenantId, poId }, "runOrchestrationWorkflow: PO is DELETED; execution aborted");
    return {
      poId,
      workflowId,
      status: "DELETED",
      isBusinessException: true,
      validationErrors: ["PO has been deleted"],
      currentStep: "terminated"
    };
  }

  // Rule 8: Idempotent short-circuit if PO is already COMPLETED
  if (po.status === "COMPLETED") {
    const existingInvoice = await InvoiceRepository.findByPoId(tenantId, poId);
    logger.info({ tenantId, poId, invoiceId: existingInvoice?._id }, "runOrchestrationWorkflow: PO is already COMPLETED; returning existing invoice without reprocessing");
    return {
      poId,
      workflowId,
      status: "COMPLETED",
      isBusinessException: false,
      validationErrors: [],
      invoiceId: (existingInvoice as any)?._id?.toString() || (existingInvoice as any)?.id,
      invoiceNumber: existingInvoice?.invoiceNumber,
      currentStep: "posting"
    };
  }

  // HUMAN REVIEW GATE (Rule 1 & Rule 2)
  const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
  const rejectedReview = allReviews.find((r) => r.status === "REJECTED");

  // Gate A: REJECTED terminal branch & cascading rejection enforcement
  if (rejectedReview) {
    logger.info({ tenantId, poId, reviewId: rejectedReview._id.toString() }, "Human Review Gate: PO has a REJECTED review; terminating workflow");
    await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "REJECTED", {
      terminatedAt: new Date(),
      terminationReason: rejectedReview.reason || "Rejected in human review",
      failureReason: rejectedReview.reason || "Rejected in human review"
    });
    await ReviewRepository.rejectOpenReviewsForEntity(
      tenantId,
      poId,
      `Cascaded rejection from exception ${rejectedReview._id.toString()}: ${rejectedReview.reason}`
    );
    return {
      poId,
      workflowId,
      status: "REJECTED",
      isBusinessException: true,
      validationErrors: [rejectedReview.reason || "Rejected in human review"],
      currentStep: "terminated"
    };
  }

  // Gate B: Multi-exception all-approval check (Rule 2)
  const pendingReviews = allReviews.filter((r) => r.status === "PENDING" || r.status === "ESCALATED");
  if (pendingReviews.length > 0) {
    logger.info(
      { tenantId, poId, pendingCount: pendingReviews.length },
      "Human Review Gate: PO has open review items; remaining in HUMAN_REVIEW until ALL are approved"
    );
    return {
      poId,
      workflowId,
      status: "HUMAN_REVIEW",
      isBusinessException: true,
      validationErrors: pendingReviews.map((r) => r.reason || "Pending human review"),
      currentStep: "human_review"
    };
  }

  // Gate C: APPROVED sign-off branch (Rule 3)
  const isHumanApproved =
    (allReviews.length > 0 && allReviews.every((r) => r.status === "APPROVED")) ||
    po.status === "HUMAN_APPROVED";

  if (isHumanApproved) {
    logger.info({ tenantId, poId }, "Human Review Gate: All exceptions approved; resuming directly to Posting node");
    const reconciledTax = reconcileTaxFromLineItems(po.lineItems);
    await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "HUMAN_APPROVED", {
      extractionConfidence: 1.0,
      humanReviewedAt: new Date(),
      humanReviewedBy: "Human Reviewer",
      ...(reconciledTax !== null ? { tax: reconciledTax } : {})
    });
  }

  const graph = buildOrchestrationGraph(tenantId);

  const timeoutMs = options?.timeoutMs || Number(process.env.WORKFLOW_TIMEOUT_MS) || 60000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const initialState = {
      tenantId,
      poId,
      workflowId,
      documentName: po.documentName,
      s3Key: po.s3Key,
      currentStep: isHumanApproved ? "posting" : "intake",
      status: isHumanApproved ? "HUMAN_APPROVED" : "PROCESSING",
      toolCallCount: 0,
      validationChecks: [],
      validationErrors: [],
      evidence: [],
      policySourceReferences: [],
      matchedLineItems: [],
      approvalRequired: false,
      isBusinessException: false,
      allowedVariancePct: 10.0,
      stepRetries: {},
      isHumanApproved,
      skipValidation: isHumanApproved,
      resumedFromStep: isHumanApproved ? "posting" : undefined
    };

    if (options?.onStepUpdate) {
      options.onStepUpdate({
        step: isHumanApproved ? "posting" : "intake",
        status: isHumanApproved ? "HUMAN_APPROVED" : "PROCESSING",
        details: { poId, workflowId },
        timestamp: new Date().toISOString()
      });
    }

    let finalState = initialState as unknown as WorkflowState;
    const stream = await graph.stream(initialState, {
      configurable: { thread_id: poId },
      streamMode: "values",
      signal: controller.signal
    });
    for await (const stateChunk of stream) {
      if (controller.signal.aborted) {
        throw new Error(`Workflow orchestration timed out. Operation exceeded ${Math.round(timeoutMs / 1000)}s limit.`);
      }
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
      currentStep: finalState.currentStep || "completed",
      noActiveContract: finalState.noActiveContract
    };
  } catch (err: any) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Workflow orchestration timed out. Operation exceeded ${Math.round(timeoutMs / 1000)}s limit.`);
      logger.error({ err: timeoutError, tenantId, poId }, "LangGraph orchestration timed out and was aborted");
      await PurchaseOrderRepository.updateStatus(tenantId, poId, "FAILED", timeoutError.message);
      await AuditRepository.create(tenantId, {
        agentName: "SupervisorAgent",
        action: "WORKFLOW_EXECUTION_FAILED",
        status: "FAILURE",
        entityId: poId,
        workflowId,
        summary: `Orchestration workflow execution timed out: ${timeoutError.message}`
      });
      throw timeoutError;
    }
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
  } finally {
    clearTimeout(timeoutId);
  }
}
