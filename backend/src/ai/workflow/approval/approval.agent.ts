import { WorkflowState } from "../state.js";
import {
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Agent 5: Approval Decision Agent (100% Deterministic TypeScript)
 * Evaluates whether PO meets automated criteria or must be routed for human managerial approval.
 */
export function createApprovalDecisionNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "ApprovalDecisionAgent: Evaluating approval criteria");
    const startTime = Date.now();

    const hasValidationErrors = (state.validationErrors || []).length > 0;
    const approvalRequired = state.approvalRequired || hasValidationErrors;

    const latency = Date.now() - startTime;

    if (approvalRequired) {
      const reason = state.approvalReason || state.validationErrors[0] || "Policy exception requiring approval";
      logger.info({ tenantId, poId: state.poId, reason }, "Approval required for purchase order");

      await AuditRepository.create(tenantId, {
        agentName: "ApprovalDecisionAgent",
        action: "APPROVAL_REQUIRED",
        status: "EXCEPTION",
        entityId: state.poId,
        workflowId: state.workflowId,
        latency,
        summary: `Approval required due to commercial or policy deviations: ${reason}`
      });

      return {
        approvalRequired: true,
        approvalReason: reason,
        isBusinessException: true,
        currentStep: "approval_decision"
      };
    }

    // Auto-approval passed
    await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "APPROVED");

    await AuditRepository.create(tenantId, {
      agentName: "ApprovalDecisionAgent",
      action: "AUTO_APPROVED",
      status: "SUCCESS",
      entityId: state.poId,
      workflowId: state.workflowId,
      latency,
      summary: "Purchase order automatically approved under standard tolerance rules"
    });

    return {
      approvalRequired: false,
      isBusinessException: false,
      status: "APPROVED",
      currentStep: "approval_decision"
    };
  };
}
