/**
 * deterministic.ts — Plain deterministic TypeScript orchestrator.
 *
 * Replaces the LangGraph StateGraph/Annotation machinery with a simple
 * sequential loop over the 7 existing agent functions.  All 10 business rules
 * from the previous graph.ts are preserved verbatim; only the framework glue
 * is replaced.
 *
 * State is stored as `po.pipelineState` (single source of truth — no separate
 * workflow_checkpoints collection).  Pause/resume is explicit field assignment:
 * no reducers, no merging, no sentinel gymnastics.
 */

import { v4 as uuidv4 } from "uuid";
import { createExtractionNode } from "./extraction/extraction.agent.js";
import { createMatchingNode } from "./matching/matching.agent.js";
import { createPOValidationNode } from "./po/po.agent.js";
import { createPolicyEvaluationNode } from "./policy/policy.agent.js";
import { createApprovalDecisionNode } from "./approval/approval.agent.js";
import { createExceptionNode } from "./exception/exception.agent.js";
import { createPostingNode } from "./posting/posting.agent.js";
import {
  PurchaseOrderRepository,
  AuditRepository,
  ReviewRepository,
  InvoiceRepository,
  reconcileTaxFromLineItems
} from "../../repositories/index.js";
import { logger } from "../../utils/logger.js";
import { WorkflowState } from "./state.js";

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

// ---------------------------------------------------------------------------
// PipelineState — plain TypeScript interface (no Annotation / reducer magic)
// ---------------------------------------------------------------------------

export interface PipelineState {
  // Identity
  tenantId: string;
  poId: string;
  workflowId: string;
  documentName: string;
  s3Key: string;

  // Stage outputs
  extractedData?: any;
  customerId?: string;
  customerName?: string;
  matchedLineItems?: any[];
  validationChecks?: any[];
  validationErrors: string[];
  evidence?: any[];
  allowedVariancePct: number;
  policySourceReferences?: string[];
  noActiveContract?: boolean;
  requiresCatalogReview?: boolean;
  approvalRequired: boolean;
  approvalReason?: string;
  reviewId?: string;
  invoiceId?: string;
  invoiceNumber?: string;
  s3PdfKey?: string;
  erpPostingId?: string;

  // Control flags
  isBusinessException: boolean;
  isHumanApproved: boolean;
  skipValidation: boolean;

  // Lifecycle
  status: string;
  currentStep: string;
  failureReason?: string;
  technicalError?: string;
  toolCallCount: number;
  stepRetries: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function makeInitialState(
  tenantId: string,
  poId: string,
  workflowId: string,
  po: any,
  isHumanApproved: boolean
): PipelineState {
  return {
    tenantId,
    poId,
    workflowId,
    documentName: po.documentName,
    s3Key: po.s3Key,
    validationErrors: [],
    validationChecks: [],
    evidence: [],
    policySourceReferences: [],
    matchedLineItems: [],
    allowedVariancePct: 10.0,
    approvalRequired: false,
    isBusinessException: false,
    isHumanApproved,
    skipValidation: isHumanApproved,
    status: isHumanApproved ? "HUMAN_APPROVED" : "PROCESSING",
    currentStep: isHumanApproved ? "posting" : "intake",
    toolCallCount: 0,
    stepRetries: {}
  };
}

/** Merge a partial update into state.  No reducers — last write wins for every field.
 *  Arrays: explicit assignment (update !== undefined replaces).
 *  Booleans: explicit assignment (update !== undefined replaces).
 */
function applyUpdate(state: PipelineState, update: Partial<PipelineState>): PipelineState {
  return { ...state, ...update };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runDeterministicWorkflow(
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

  // ── Rule 1: REJECTED terminal ──────────────────────────────────────────────
  if (po.status === "REJECTED") {
    logger.info({ tenantId, poId }, "DeterministicOrchestrator: PO is REJECTED; aborting");
    return {
      poId, workflowId,
      status: "REJECTED",
      isBusinessException: true,
      validationErrors: [po.failureReason || po.terminationReason || "PO is rejected"],
      currentStep: "terminated"
    };
  }

  // ── Rule 8 (DELETED) ───────────────────────────────────────────────────────
  if (po.status === "DELETED") {
    logger.info({ tenantId, poId }, "DeterministicOrchestrator: PO is DELETED; aborting");
    return {
      poId, workflowId,
      status: "DELETED",
      isBusinessException: true,
      validationErrors: ["PO has been deleted"],
      currentStep: "terminated"
    };
  }

  // ── Rule 7: Idempotent short-circuit for COMPLETED ────────────────────────
  if (po.status === "COMPLETED") {
    const existingInvoice = await InvoiceRepository.findByPoId(tenantId, poId);
    logger.info({ tenantId, poId, invoiceId: existingInvoice?._id }, "DeterministicOrchestrator: already COMPLETED; returning existing invoice");
    return {
      poId, workflowId,
      status: "COMPLETED",
      isBusinessException: false,
      validationErrors: [],
      invoiceId: (existingInvoice as any)?._id?.toString() || (existingInvoice as any)?.id,
      invoiceNumber: existingInvoice?.invoiceNumber,
      currentStep: "posting"
    };
  }

  // ── Human Review Gate ──────────────────────────────────────────────────────
  const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
  const rejectedReview = allReviews.find((r) => r.status === "REJECTED");

  // Gate A: Cascading rejection (Rule 6)
  if (rejectedReview) {
    logger.info({ tenantId, poId, reviewId: rejectedReview._id.toString() }, "DeterministicOrchestrator: PO has REJECTED review; terminating");
    await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "REJECTED", {
      terminatedAt: new Date(),
      terminationReason: rejectedReview.reason || "Rejected in human review",
      failureReason: rejectedReview.reason || "Rejected in human review"
    });
    await ReviewRepository.rejectOpenReviewsForEntity(
      tenantId, poId,
      `Cascaded rejection from exception ${rejectedReview._id.toString()}: ${rejectedReview.reason}`
    );
    return {
      poId, workflowId,
      status: "REJECTED",
      isBusinessException: true,
      validationErrors: [rejectedReview.reason || "Rejected in human review"],
      currentStep: "terminated"
    };
  }

  // Gate B: All-approval check (Rule 2)
  const pendingReviews = allReviews.filter((r) => r.status === "PENDING" || r.status === "ESCALATED");
  if (pendingReviews.length > 0) {
    logger.info({ tenantId, poId, pendingCount: pendingReviews.length }, "DeterministicOrchestrator: awaiting all review approvals");
    return {
      poId, workflowId,
      status: "HUMAN_REVIEW",
      isBusinessException: true,
      validationErrors: pendingReviews.map((r) => r.reason || "Pending human review"),
      currentStep: "human_review"
    };
  }

  // Gate C: Human-approved sign-off branch (Rule 3)
  const isHumanApproved =
    (allReviews.length > 0 && allReviews.every((r) => r.status === "APPROVED")) ||
    po.status === "HUMAN_APPROVED";

  if (isHumanApproved) {
    logger.info({ tenantId, poId }, "DeterministicOrchestrator: all exceptions approved; updating PO status and proceeding to posting");
    const reconciledTax = reconcileTaxFromLineItems(po.lineItems);
    await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "HUMAN_APPROVED", {
      extractionConfidence: 1.0,
      humanReviewedAt: new Date(),
      humanReviewedBy: "Human Reviewer",
      ...(reconciledTax !== null ? { tax: reconciledTax } : {})
    });
  }

  // ── Build initial state & hydrate from persisted state if available ────────
  const persistedState = (await PurchaseOrderRepository.loadPipelineState(tenantId, poId)) as PipelineState | null;
  let state: PipelineState = makeInitialState(tenantId, poId, workflowId, po, isHumanApproved);

  if (persistedState && !(persistedState as any).completed) {
    state = applyUpdate(state, persistedState);
    if (isHumanApproved) {
      state = applyUpdate(state, {
        validationErrors: [],
        validationChecks: [],
        isBusinessException: false,
        isHumanApproved: true,
        skipValidation: true,
        currentStep: "posting",
        status: "HUMAN_APPROVED"
      });
    }
  }

  // Emit initial step event
  if (options?.onStepUpdate) {
    options.onStepUpdate({
      step: state.currentStep,
      status: state.status,
      details: { poId, workflowId },
      timestamp: new Date().toISOString()
    });
  }

  // Persist initial state
  await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);

  // ── Build agent functions (closure-bound to tenantId) ─────────────────────
  const allStages: Array<{ name: string; fn: (s: PipelineState) => Promise<Partial<PipelineState>> }> = [
    { name: "extraction",       fn: createExtractionNode(tenantId) as any },
    { name: "matching",         fn: createMatchingNode(tenantId) as any },
    { name: "poValidation",     fn: createPOValidationNode(tenantId) as any },
    { name: "policyEvaluation", fn: createPolicyEvaluationNode(tenantId) as any },
    { name: "approvalDecision", fn: createApprovalDecisionNode(tenantId) as any },
  ];

  let stages: Array<{ name: string; fn: (s: PipelineState) => Promise<Partial<PipelineState>> }> = isHumanApproved
    ? [{ name: "posting", fn: createPostingNode(tenantId) as any }]
    : allStages;

  // Mid-flight recovery: If recovering mid-run from a previously completed step (not exception/completed),
  // resume at the subsequent stage rather than repeating completed stages.
  if (!isHumanApproved && persistedState?.currentStep && !persistedState.isBusinessException) {
    const lastStepIndex = allStages.findIndex((s) => s.name === persistedState.currentStep);
    if (lastStepIndex >= 0 && lastStepIndex < allStages.length - 1) {
      logger.info(
        { tenantId, poId, resumedAfter: persistedState.currentStep, nextStep: allStages[lastStepIndex + 1].name },
        "DeterministicOrchestrator: Resuming mid-flight execution from persisted state"
      );
      stages = allStages.slice(lastStepIndex + 1);
    }
  }

  // ── Timeout guard ──────────────────────────────────────────────────────────
  const timeoutMs = options?.timeoutMs || Number(process.env.WORKFLOW_TIMEOUT_MS) || 60000;
  let timedOut = false;
  const timeoutHandle = setTimeout(() => { timedOut = true; }, timeoutMs);

  try {
    // ── Sequential stage loop ─────────────────────────────────────────────────
    for (const { name, fn } of stages) {
      if (timedOut) {
        throw new Error(`Workflow orchestration timed out. Operation exceeded ${Math.round(timeoutMs / 1000)}s limit.`);
      }

      logger.info({ tenantId, poId, stage: name }, "DeterministicOrchestrator: executing stage");
      state = applyUpdate(state, { currentStep: name });

      const update = await fn(state);
      state = applyUpdate(state, update as Partial<PipelineState>);

      // Persist after each stage
      await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);

      // Emit step event
      if (options?.onStepUpdate && name !== "intake") {
        options.onStepUpdate({
          step: name,
          status: state.status,
          isBusinessException: Boolean(state.isBusinessException),
          details: {
            validationErrorsCount: state.validationErrors?.length || 0,
            evidenceCount: state.evidence?.length || 0,
            invoiceNumber: state.invoiceNumber,
            reviewId: state.reviewId,
            erpPostingId: state.erpPostingId
          },
          timestamp: new Date().toISOString()
        });
      }

      // ── Routing decisions (replaces conditional edges) ─────────────────────
      if (name === "extraction") {
        const needsException =
          !state.isHumanApproved &&
          !state.skipValidation &&
          (state.technicalError || !state.extractedData || (state.extractedData?.confidence ?? 1.0) < 0.75);
        if (needsException) {
          logger.info({ poId }, "DeterministicOrchestrator: routing extraction → exception");
          state = applyUpdate(state, await createExceptionNode(tenantId)(state as any) as any);
          await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);
          emitStep(options, "exception", state);
          break; // exception is terminal for this run
        }
      }

      if (name === "poValidation") {
        const needsException =
          !state.isHumanApproved &&
          !state.skipValidation &&
          ((state.validationErrors && state.validationErrors.length > 0) || state.isBusinessException);
        if (needsException) {
          logger.info({ poId, errors: state.validationErrors }, "DeterministicOrchestrator: routing poValidation → exception");
          state = applyUpdate(state, await createExceptionNode(tenantId)(state as any) as any);
          await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);
          emitStep(options, "exception", state);
          break;
        }
      }

      if (name === "approvalDecision") {
        const needsException =
          !state.isHumanApproved &&
          ((state.validationErrors && state.validationErrors.length > 0) ||
            state.isBusinessException ||
            state.approvalRequired);
        if (needsException) {
          logger.info({ poId }, "DeterministicOrchestrator: routing approvalDecision → exception");
          state = applyUpdate(state, await createExceptionNode(tenantId)(state as any) as any);
          await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);
          emitStep(options, "exception", state);
          break;
        }
        // No exception: continue to posting
        logger.info({ poId }, "DeterministicOrchestrator: routing approvalDecision → posting");
        state = applyUpdate(state, { currentStep: "posting" });
        const postingUpdate = await createPostingNode(tenantId)(state as any);
        state = applyUpdate(state, postingUpdate as Partial<PipelineState>);
        await PurchaseOrderRepository.savePipelineState(tenantId, poId, state as any);
        emitStep(options, "posting", state);
        break;
      }
    }

    // ── Terminal: prune pipeline state if COMPLETED ────────────────────────
    if (state.status === "COMPLETED") {
      await PurchaseOrderRepository.savePipelineState(tenantId, poId, { completed: true, completedAt: new Date().toISOString() });
    }

    return {
      poId,
      workflowId,
      status: state.status || "COMPLETED",
      isBusinessException: Boolean(state.isBusinessException),
      invoiceId: state.invoiceId,
      invoiceNumber: state.invoiceNumber,
      reviewId: state.reviewId,
      erpPostingId: state.erpPostingId,
      validationErrors: state.validationErrors || [],
      currentStep: state.currentStep || "completed",
      noActiveContract: state.noActiveContract
    };

  } catch (err: any) {
    const isTimeout = timedOut || err.message?.includes("timed out");
    const errMsg = isTimeout
      ? `Workflow orchestration timed out. Operation exceeded ${Math.round(timeoutMs / 1000)}s limit.`
      : err.message;

    logger.error({ err, tenantId, poId, isTimeout }, "DeterministicOrchestrator: execution failed");
    await PurchaseOrderRepository.updateStatus(tenantId, poId, "FAILED", errMsg);
    await AuditRepository.create(tenantId, {
      agentName: "DeterministicOrchestrator",
      action: "WORKFLOW_EXECUTION_FAILED",
      status: "FAILURE",
      entityId: poId,
      workflowId,
      summary: `Deterministic orchestration failed: ${errMsg}`
    });
    throw isTimeout ? new Error(errMsg) : err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------
function emitStep(options: WorkflowExecutionOptions | undefined, step: string, state: PipelineState) {
  if (!options?.onStepUpdate) return;
  options.onStepUpdate({
    step,
    status: state.status,
    isBusinessException: Boolean(state.isBusinessException),
    details: {
      validationErrorsCount: state.validationErrors?.length || 0,
      evidenceCount: state.evidence?.length || 0,
      invoiceNumber: state.invoiceNumber,
      reviewId: state.reviewId,
      erpPostingId: state.erpPostingId
    },
    timestamp: new Date().toISOString()
  });
}

export const runOrchestrationWorkflow = runDeterministicWorkflow;
