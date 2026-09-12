import { PurchaseOrderRepository, ReviewRepository, AuditRepository } from "../../repositories/index.js";
import { logger } from "../../utils/logger.js";

export async function handleResumeExhausted(
  tenantId: string,
  poId: string,
  approvedReviewId: string,
  err: Error
): Promise<void> {
  logger.error(
    { err, tenantId, poId, approvedReviewId },
    "Workflow resume permanently failed after all retry attempts; reopening review ticket"
  );

  await PurchaseOrderRepository.updateStatus(tenantId, poId, "FAILED", err.message);

  const original = await ReviewRepository.findById(tenantId, approvedReviewId);

  await ReviewRepository.create(tenantId, {
    entity: "purchase_order",
    entityId: poId,
    stage: original?.stage || "validation",
    status: "PENDING",
    priority: "CRITICAL",
    reason: `Pipeline resume failed after approval (all retries exhausted): ${err.message}`,
    requestedByAgent: "SupervisorAgent",
    evidence: []
  });

  await AuditRepository.create(tenantId, {
    agentName: "SupervisorAgent",
    action: "RESUME_FAILED_AFTER_APPROVAL",
    status: "FAILURE",
    entityId: poId,
    workflowId: "manual_review",
    summary: `Workflow resume failed after human approval; all retry attempts exhausted: ${err.message}`
  });
}
