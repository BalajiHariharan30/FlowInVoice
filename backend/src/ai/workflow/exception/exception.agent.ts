import { WorkflowState } from "../state.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { ReviewStage, ReviewPriority } from "../../../types/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Agent 6: Exception / Human Review Agent (100% Deterministic TypeScript)
 * Escalates business exceptions to the Review Center with structured evidence.
 */
export function createExceptionNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId, step: state.currentStep }, "ExceptionAgent: Routing to human review");
    const startTime = Date.now();

    const errors = state.validationErrors || [];
    const reason =
      state.approvalReason ||
      errors[0] ||
      state.failureReason ||
      "Automated verification exception";

    // Determine review stage based on current step
    let stage: ReviewStage = "validation";
    if (state.currentStep === "extraction" || state.currentStep === "po_validation") {
      stage = "extraction";
    } else if (state.currentStep === "posting") {
      stage = "invoice";
    }

    const isCritical =
      reason.toLowerCase().includes("duplicate") ||
      reason.toLowerCase().includes("math mismatch");
    const priority: ReviewPriority = isCritical ? "CRITICAL" : "HIGH";

    // Check if an open PENDING review ticket already exists to prevent duplicate review accumulation
    const existingPending = await ReviewRepository.findPendingByEntityId(tenantId, state.poId);
    let reviewId: string;
    if (existingPending) {
      reviewId = existingPending._id.toString();
      await ReviewRepository.updateReview(tenantId, reviewId, {
        reason,
        priority,
        stage,
        actualValue: reason,
        evidence: state.evidence || []
      });
      logger.info({ tenantId, poId: state.poId, reviewId }, "ExceptionAgent: Updated existing open review ticket");
    } else {
      // Create Human Review Record
      const review = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: state.poId,
        stage,
        status: "PENDING",
        priority,
        reason,
        requestedByAgent: `FlowInvoice_${state.currentStep || "Workflow"}`,
        expectedValue: "Within Contract/Policy Limits",
        actualValue: reason,
        evidence: state.evidence || []
      });
      reviewId = review._id.toString();
      logger.info({ tenantId, poId: state.poId, reviewId }, "ExceptionAgent: Created new review ticket");
    }

    // Mark PO in HUMAN_REVIEW status
    await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "HUMAN_REVIEW", reason);

    const latency = Date.now() - startTime;
    await AuditRepository.create(tenantId, {
      agentName: "ExceptionAgent",
      action: "ROUTED_TO_HUMAN_REVIEW",
      status: "EXCEPTION",
      entityId: state.poId,
      workflowId: state.workflowId,
      latency,
      summary: `Workflow exception escalated to Review Center (${stage} stage): ${reason}. Attached ${state.evidence?.length || 0} evidence items.`
    });

    return {
      reviewId,
      status: "HUMAN_REVIEW",
      isBusinessException: true,
      currentStep: "exception"
    };
  };
}
