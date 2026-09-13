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
import { PurchaseOrderEntity, DomainError, mapToEntityStatus } from "../../domain/entities/purchase-order.entity.js";

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
// Routers
// ---------------------------------------------------------------------------

// Router 1: Extraction -> Matching or Exception
export const shouldContinueAfterExtraction = (state: WorkflowState): "matching" | "exception" => {
  // Human sign-off defense: a human already approved this PO. Do not
  // re-evaluate extraction confidence — a fresh OCR pass on resume can
  // legitimately come back with the same low confidence as the original
  // pass (same document), which without this check sends an approved PO
  // straight back into Exception with the original error, looping forever.
  // Routers 2 and 3 already have this check; this one was missed.
  // Downstream posting reads line items from the persisted PO record
  // (already corrected by the reviewer), not from this extraction state,
  // so bypassing here is safe even if this extraction pass came back weak.
  if (state.isHumanApproved || state.skipValidation) {
    return "matching";
  }
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

// ---------------------------------------------------------------------------
// Checkpoint-based Resume Resolver
// ---------------------------------------------------------------------------

/**
 * Determines the authoritative stage at which an approved PO must resume.
 * Strict checkpoint-based resumption:
 *  - Stopped at extraction -> resumes at matching (extraction ran once and is never repeated)
 *  - Stopped at matching -> resumes at poValidation
 *  - Stopped at poValidation -> resumes at policyEvaluation (extraction & matching are never repeated)
 *  - Stopped at policyEvaluation -> resumes at approvalDecision
 *  - Stopped at approvalDecision, posting, or invoice -> resumes at posting
 */
export function calculateResumeStage(
  review?: { stage?: string; checkpointStep?: string; requestedByAgent?: string } | null,
  persistedStep?: string
): "matching" | "poValidation" | "policyEvaluation" | "approvalDecision" | "posting" {
  const step =
    review?.checkpointStep ||
    persistedStep ||
    (review?.requestedByAgent?.startsWith("FlowInvoice_")
      ? review.requestedByAgent.replace(/^FlowInvoice_/, "")
      : undefined);

  // Case A: Review at extraction stage -> resume from matching (extraction does NOT re-run)
  if (step === "extraction" || step === "intake" || review?.stage === "extraction") {
    return "matching";
  }

  // Review at matching stage -> resume from poValidation
  if (step === "matching") {
    return "poValidation";
  }

  // Case B: Review at poValidation stage -> resume from policyEvaluation (extraction & matching do NOT re-run)
  if (
    step === "poValidation" ||
    step === "po_validation" ||
    (review?.stage === "validation" && step !== "approvalDecision" && step !== "policyEvaluation")
  ) {
    return "policyEvaluation";
  }

  // Review at policyEvaluation -> resume from approvalDecision
  if (step === "policyEvaluation") {
    return "approvalDecision";
  }

  // Case C: Review at approvalDecision, posting, or invoice validation -> resume from posting
  if (step === "approvalDecision" || step === "posting" || review?.stage === "invoice") {
    return "posting";
  }

  return "posting";
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function runDeterministicWorkflow(
  tenantId: string,
  poId: string,
  options?: WorkflowExecutionOptions,
  approvedReviewId?: string
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
  // If the caller (approval endpoint) knows exactly which ticket was resolved,
  // trust that ticket by ID instead of re-deriving "latest by createdAt" —
  // stale/duplicate PENDING tickets for the same PO have caused this gate to
  // misread approval state in the past (see collapse-duplicate-reviews.ts).
  const review = approvedReviewId
    ? await ReviewRepository.findById(tenantId, approvedReviewId)
    : await ReviewRepository.findLatestByEntityId(tenantId, poId);

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
  if (pendingReviews.length > 0 && !(approvedReviewId && review?.status === "APPROVED")) {
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
    Boolean(approvedReviewId && review?.status === "APPROVED") ||
    (allReviews.length > 0 && allReviews.every((r) => r.status === "APPROVED")) ||
    po.status === "HUMAN_APPROVED";

  if (isHumanApproved) {
    logger.info({ tenantId, poId }, "DeterministicOrchestrator: all exceptions approved; updating PO status");
    const reconciledTax = reconcileTaxFromLineItems(po.lineItems);
    await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "HUMAN_APPROVED", {
      extractionConfidence: 1.0,
      humanReviewedAt: new Date(),
      humanReviewedBy: "Human Reviewer",
      ...(reconciledTax !== null ? { tax: reconciledTax } : {})
    });
  }

  // ── Guard with PurchaseOrderEntity aggregate root ───────────────────────────
  const poEntity = PurchaseOrderEntity.create({
    id: po._id.toString(),
    tenantId: po.tenantId,
    status: mapToEntityStatus(po.status),
    vendorName: po.customerName,
    totalAmount: po.totalAmount,
    baseAmount: po.subtotal,
    taxAmount: po.tax,
    lineItems: (po.lineItems || []).map((li: any) => ({
      description: li.description || li.productCode || "",
      quantity: li.quantity || 1,
      unitPrice: li.unitPrice || 0,
      totalPrice: li.lineTotal || 0
    })),
    isResumed: Boolean(isHumanApproved),
    version: po.version || 0
  });

  if (isHumanApproved) {
    if (poEntity.status !== "DISCREPANCY_FOUND" && poEntity.status !== "READY_FOR_APPROVAL") {
      poEntity.markReadyForApproval();
    }
    poEntity.resumeExecution();
  } else if (poEntity.status === "PENDING" || poEntity.status === "VALIDATION_FAILED") {
    poEntity.startProcessing();
  }

  // ── Build initial state & hydrate from persisted state if available ────────
  const persistedState = (await PurchaseOrderRepository.loadPipelineState(tenantId, poId)) as PipelineState | null;
  let state: PipelineState = makeInitialState(tenantId, poId, workflowId, po, isHumanApproved);

  const resumeStage = isHumanApproved
    ? calculateResumeStage(review as any, persistedState?.currentStep)
    : "intake";

  if (persistedState && !(persistedState as any).completed) {
    state = applyUpdate(state, persistedState);
    if (isHumanApproved) {
      state = applyUpdate(state, {
        validationErrors: [],
        validationChecks: [],
        isBusinessException: false,
        isHumanApproved: true,
        skipValidation: true,
        currentStep: resumeStage,
        status: "HUMAN_APPROVED"
      });
    }
  }

  // Sync line items from PO if corrected or reconciled during review
  if (po.lineItems && po.lineItems.length > 0) {
    state.extractedData = state.extractedData || {};
    state.extractedData.lineItems = po.lineItems;
    if (po.subtotal !== undefined) state.extractedData.subtotal = po.subtotal;
    if (po.totalAmount !== undefined) state.extractedData.totalAmount = po.totalAmount;
    if (po.tax !== undefined) state.extractedData.tax = po.tax;
    if (po.extractionConfidence !== undefined) state.extractedData.confidence = po.extractionConfidence;
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

  let stages: Array<{ name: string; fn: (s: PipelineState) => Promise<Partial<PipelineState>> }>;

  if (isHumanApproved) {
    logger.info(
      { tenantId, poId, reviewStage: review?.stage, checkpointStep: (review as any)?.checkpointStep, resumeStage },
      "DeterministicOrchestrator: Resuming from checkpoint after human review approval"
    );

    if (resumeStage === "posting") {
      stages = [{ name: "posting", fn: createPostingNode(tenantId) as any }];
    } else {
      const resumeIndex = allStages.findIndex((s) => s.name === resumeStage);
      if (resumeIndex >= 0) {
        stages = allStages.slice(resumeIndex);
      } else {
        stages = [{ name: "posting", fn: createPostingNode(tenantId) as any }];
      }
    }
  } else if (persistedState?.currentStep && !persistedState.isBusinessException) {
    const lastStepIndex = allStages.findIndex((s) => s.name === persistedState.currentStep);
    if (lastStepIndex >= 0 && lastStepIndex < allStages.length - 1) {
      logger.info(
        { tenantId, poId, resumedAfter: persistedState.currentStep, nextStep: allStages[lastStepIndex + 1].name },
        "DeterministicOrchestrator: Resuming mid-flight execution from persisted state"
      );
      stages = allStages.slice(lastStepIndex + 1);
    } else {
      stages = allStages;
    }
  } else {
    stages = allStages;
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
        const next = shouldContinueAfterExtraction(state as any);
        if (next === "exception") {
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

/**
 * InvoiceScan DDD Pattern entrypoint: Executes deterministic pipeline
 * with aggregate root encapsulation, checkpoint preservation, and top-level error trapping.
 */
export async function runDeterministicPipeline(po: PurchaseOrderEntity): Promise<PurchaseOrderEntity> {
  try {
    // ------------------------------------------------------------------------
    // RESUMPTION CHECKPOINT DEFENSE (Prevents overwriting user corrections)
    // ------------------------------------------------------------------------
    if (po.isResumed || po.status === "READY_FOR_APPROVAL" || (po.status as string) === "HUMAN_APPROVED" || po.status === "DISCREPANCY_FOUND") {
      logger.info({ poId: po.id }, `[Pipeline] Resuming PO ${po.id} from checkpoint gate.`);
      await runDeterministicWorkflow(po.tenantId, po.id, undefined);
      const updatedPo = await PurchaseOrderRepository.findById(po.tenantId, po.id);
      if (updatedPo) {
        return PurchaseOrderEntity.create({
          id: updatedPo._id.toString(),
          tenantId: updatedPo.tenantId,
          status: mapToEntityStatus(updatedPo.status),
          vendorName: updatedPo.customerName,
          totalAmount: updatedPo.totalAmount,
          baseAmount: updatedPo.subtotal,
          taxAmount: updatedPo.tax,
          lineItems: (updatedPo.lineItems || []).map((li: any) => ({
            description: li.description || li.productCode || "",
            quantity: li.quantity || 1,
            unitPrice: li.unitPrice || 0,
            totalPrice: li.lineTotal || 0
          })),
          isResumed: true,
          version: updatedPo.version || 0
        });
      }
      return po;
    }

    po.startProcessing();
    await runDeterministicWorkflow(po.tenantId, po.id);
    const updatedPo = await PurchaseOrderRepository.findById(po.tenantId, po.id);
    if (updatedPo) {
      return PurchaseOrderEntity.create({
        id: updatedPo._id.toString(),
        tenantId: updatedPo.tenantId,
        status: mapToEntityStatus(updatedPo.status),
        vendorName: updatedPo.customerName,
        totalAmount: updatedPo.totalAmount,
        baseAmount: updatedPo.subtotal,
        taxAmount: updatedPo.tax,
        lineItems: (updatedPo.lineItems || []).map((li: any) => ({
          description: li.description || li.productCode || "",
          quantity: li.quantity || 1,
          unitPrice: li.unitPrice || 0,
          totalPrice: li.lineTotal || 0
        })),
        isResumed: false,
        version: updatedPo.version || 0
      });
    }
    return po;
  } catch (error: any) {
    logger.error({ error, poId: po.id }, `[Pipeline Error] Execution failed for PO ${po.id}`);
    po.markValidationFailed(error.message || "Unknown pipeline failure");
    return po;
  }
}
