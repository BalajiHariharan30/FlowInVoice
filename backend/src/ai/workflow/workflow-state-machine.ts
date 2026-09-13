import { POStatus } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

/**
 * Authoritative PO Lifecycle Transition Matrix
 * Enforces strict forward-only or controlled-exception transitions.
 * Terminal states (COMPLETED, REJECTED, DELETED) cannot transition to processing states.
 */
export const ALLOWED_PO_TRANSITIONS: Record<POStatus, readonly POStatus[]> = {
  UPLOADED: ["PROCESSING", "FAILED", "DELETED"],
  PROCESSING: [
    "EXTRACTED",
    "VALIDATING",
    "RAG_CHECKING",
    "COMPLIANCE_CHECKING",
    "APPROVED",
    "INVOICE_GENERATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  EXTRACTED: [
    "VALIDATING",
    "RAG_CHECKING",
    "COMPLIANCE_CHECKING",
    "APPROVED",
    "INVOICE_GENERATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  VALIDATING: [
    "RAG_CHECKING",
    "COMPLIANCE_CHECKING",
    "APPROVED",
    "INVOICE_GENERATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  RAG_CHECKING: [
    "COMPLIANCE_CHECKING",
    "APPROVED",
    "INVOICE_GENERATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  COMPLIANCE_CHECKING: [
    "APPROVED",
    "INVOICE_GENERATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  HUMAN_REVIEW: [
    "HUMAN_APPROVED",
    "REJECTED",
    "FAILED",
    "DELETED"
  ],
  HUMAN_APPROVED: [
    "INVOICE_GENERATING",
    "COMPLETED",
    "FAILED",
    "DELETED"
  ],
  APPROVED: [
    "INVOICE_GENERATING",
    "COMPLETED",
    "FAILED",
    "DELETED"
  ],
  INVOICE_GENERATING: [
    "INVOICE_VALIDATING",
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  INVOICE_VALIDATING: [
    "COMPLETED",
    "HUMAN_REVIEW",
    "FAILED",
    "DELETED"
  ],
  // Terminal state: an already COMPLETED invoice cannot be resurrected
  COMPLETED: ["DELETED"],
  // Terminal state: an already REJECTED PO cannot be resurrected
  REJECTED: ["DELETED"],
  // Controlled retry only: FAILED can be restarted into PROCESSING or soft-deleted
  FAILED: ["PROCESSING", "DELETED"],
  // Absolutely terminal
  DELETED: []
} as const;

/**
 * Validates whether transitioning from currentStatus to targetStatus is permitted.
 */
export function isValidPOTransition(currentStatus: POStatus, targetStatus: POStatus): boolean {
  if (currentStatus === targetStatus) {
    // Idempotent self-transition is considered safe
    return true;
  }
  const allowed = ALLOWED_PO_TRANSITIONS[currentStatus];
  if (!allowed) {
    logger.warn({ currentStatus, targetStatus }, "State Machine: Unknown current status encountered");
    return false;
  }
  return (allowed as readonly POStatus[]).includes(targetStatus);
}

/**
 * Returns the list of preceding statuses that are legally allowed to transition to targetStatus.
 * Useful for atomic MongoDB findOneAndUpdate filters: { status: { $in: getAllowedPrecedingStatuses(target) } }
 */
export function getAllowedPrecedingStatuses(targetStatus: POStatus): POStatus[] {
  const preceding: POStatus[] = [targetStatus]; // include target itself for idempotency
  for (const [status, allowedNext] of Object.entries(ALLOWED_PO_TRANSITIONS)) {
    if ((allowedNext as readonly POStatus[]).includes(targetStatus)) {
      preceding.push(status as POStatus);
    }
  }
  return preceding;
}
