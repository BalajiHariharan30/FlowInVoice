import { WorkflowState } from "../state.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { ReviewStage, ReviewPriority } from "../../../types/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Generates a structured diagnosis object when a PO accumulates >= 3 exceptions.
 */
export function generateDiagnosis(
  reason: string,
  errorCount: number,
  allErrors: string[]
): { failurePatternSummary: string; rootCauseCategory: string; recommendedAction: string } {
  const lowerReason = (reason + " " + allErrors.join(" ")).toLowerCase();

  let rootCauseCategory = "GENERAL_VALIDATION_ERROR";
  let failurePatternSummary = `This purchase order has accumulated ${errorCount} exceptions during automated processing.`;
  let recommendedAction = "Review document values and apply manual adjustments in Review Center.";

  if (
    lowerReason.includes("confidence") ||
    lowerReason.includes("ocr") ||
    lowerReason.includes("blurry") ||
    lowerReason.includes("low_confidence")
  ) {
    rootCauseCategory = "EXTRACTION_CONFIDENCE";
    failurePatternSummary = `This PO has failed optical character recognition ${errorCount} times due to low scan resolution or ambiguous text layout.`;
    recommendedAction = "Re-scan the original purchase order at 300+ DPI or manually transcribe line items.";
  } else if (
    lowerReason.includes("math") ||
    lowerReason.includes("mismatch") ||
    lowerReason.includes("sum") ||
    lowerReason.includes("tax")
  ) {
    rootCauseCategory = "MATH_MISMATCH";
    failurePatternSummary = `Repeated arithmetic inconsistencies detected across ${errorCount} processing runs (line quantity * price does not reconcile with stated total/tax).`;
    recommendedAction = "Manually correct line item quantities and unit prices in the Review Center table.";
  } else if (lowerReason.includes("duplicate")) {
    rootCauseCategory = "DUPLICATE_PO";
    failurePatternSummary = `Duplicate PO number collision detected across ${errorCount} ingestion attempts.`;
    recommendedAction = "Verify if this is a duplicate order or assign a unique suffix (e.g. -REV1) to allow ingestion.";
  } else if (lowerReason.includes("currency")) {
    rootCauseCategory = "CURRENCY_MISMATCH";
    failurePatternSummary = `Multi-currency discrepancy: line items have divergent currencies compared to PO header.`;
    recommendedAction = "Convert all line items to the uniform single currency before posting.";
  } else if (
    lowerReason.includes("sku") ||
    lowerReason.includes("uncataloged") ||
    lowerReason.includes("catalog")
  ) {
    rootCauseCategory = "UNCATALOGED_SKU";
    failurePatternSummary = `Uncataloged item code not found in enterprise product catalog exceeding approval threshold.`;
    recommendedAction = "Register the new SKU in the product catalog or approve as a custom one-time item.";
  } else if (
    lowerReason.includes("contract") ||
    lowerReason.includes("price") ||
    lowerReason.includes("variance") ||
    lowerReason.includes("policy")
  ) {
    rootCauseCategory = "PRICE_VARIANCE_POLICY";
    failurePatternSummary = `Pricing exceeds contracted terms or policy variance threshold (>10%) across ${errorCount} evaluation cycles.`;
    recommendedAction = "Verify contract price schedule or obtain special finance approval.";
  }

  return { failurePatternSummary, rootCauseCategory, recommendedAction };
}

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

    // Rule 4: Once a PO accumulates >= 3 errors/exceptions, generate a structured suggestedFix diagnosis
    const previousReviews = await ReviewRepository.findByEntityId(tenantId, state.poId);
    const po = await PurchaseOrderRepository.findById(tenantId, state.poId);
    const totalErrorCount = previousReviews.length + (po?.retryCount || 0) + (state.validationErrors?.length || 1);

    let suggestedFix: any = undefined;
    if (totalErrorCount >= 3 || previousReviews.length >= 2 || (po?.retryCount || 0) >= 2) {
      suggestedFix = generateDiagnosis(reason, totalErrorCount, state.validationErrors || []);
      logger.info(
        { tenantId, poId: state.poId, rootCauseCategory: suggestedFix.rootCauseCategory },
        "ExceptionAgent: Generated structured suggestedFix diagnosis for repeated exceptions"
      );
    }
    // Bug 4 Protection: Check if an approved review ticket already exists for this PO
    const existingApproved = previousReviews.find(
      (r) => r.status === "APPROVED" && (r.stage === stage || r.reason === reason || !stage)
    );
    if (existingApproved || state.isHumanApproved || po?.status === "HUMAN_APPROVED") {
      logger.warn(
        { tenantId, poId: state.poId, reason, approvedReviewId: existingApproved?._id?.toString() },
        "DUPLICATE_EXCEPTION_AFTER_APPROVAL — possible state bug: PO already has an approved review ticket. Bypassing duplicate ticket creation and force-resuming workflow to posting."
      );
      await AuditRepository.create(tenantId, {
        agentName: "ExceptionAgent",
        action: "DUPLICATE_EXCEPTION_AFTER_APPROVAL",
        status: "SUCCESS",
        entityId: state.poId,
        workflowId: state.workflowId,
        latency: Date.now() - startTime,
        summary: `DUPLICATE_EXCEPTION_AFTER_APPROVAL — possible state bug: Bypassed duplicate review ticket creation for already-approved PO (${state.poId}). Resuming to posting.`
      });
      return {
        isBusinessException: false,
        validationErrors: [],
        isHumanApproved: true,
        currentStep: "posting",
        status: "HUMAN_APPROVED"
      };
    }

    // Check if an open PENDING review ticket already exists to prevent duplicate review accumulation
    const existingPending = await ReviewRepository.findPendingByEntityId(tenantId, state.poId);
    let reviewId: string;
    if (existingPending) {
      reviewId = existingPending._id.toString();

      // Merge and deduplicate evidence across workflow runs (§Step 7 Remediation)
      const existingEvidence = existingPending.evidence || [];
      const newEvidence = state.evidence || [];
      const mergedEvidence = [...existingEvidence];

      for (const ev of newEvidence) {
        const isDuplicate = mergedEvidence.some(
          (e) =>
            (e.chunkId && ev.chunkId && e.chunkId === ev.chunkId) ||
            (e.documentId === ev.documentId && e.section === ev.section)
        );
        if (!isDuplicate) {
          mergedEvidence.push(ev);
        }
      }

      await ReviewRepository.updateReview(tenantId, reviewId, {
        reason,
        priority,
        stage,
        actualValue: reason,
        evidence: mergedEvidence,
        ...(suggestedFix ? { suggestedFix } : {})
      });
      logger.info(
        { tenantId, poId: state.poId, reviewId, evidenceCount: mergedEvidence.length },
        "ExceptionAgent: Updated existing open review ticket with merged evidence"
      );
    } else {
      // Create Human Review Record
      try {
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
          evidence: state.evidence || [],
          ...(suggestedFix ? { suggestedFix } : {})
        });
        reviewId = review._id.toString();
        logger.info({ tenantId, poId: state.poId, reviewId }, "ExceptionAgent: Created new review ticket");
      } catch (err: any) {
        // Handle MongoServerError code 11000 from unique partial index { tenantId, entityId } (status: "PENDING")
        if (err.code === 11000 || (err.name === "MongoServerError" && err.code === 11000)) {
          logger.warn(
            { tenantId, poId: state.poId, err: err.message },
            "ExceptionAgent: Concurrent duplicate pending review ticket race caught; re-fetching existing ticket"
          );
          const concurrentPending = await ReviewRepository.findPendingByEntityId(tenantId, state.poId);
          if (concurrentPending) {
            reviewId = concurrentPending._id.toString();

            const existingEvidence = concurrentPending.evidence || [];
            const newEvidence = state.evidence || [];
            const mergedEvidence = [...existingEvidence];

            for (const ev of newEvidence) {
              const isDuplicate = mergedEvidence.some(
                (e) =>
                  (e.chunkId && ev.chunkId && e.chunkId === ev.chunkId) ||
                  (e.documentId === ev.documentId && e.section === ev.section)
              );
              if (!isDuplicate) {
                mergedEvidence.push(ev);
              }
            }

            await ReviewRepository.updateReview(tenantId, reviewId, {
              reason,
              priority,
              stage,
              actualValue: reason,
              evidence: mergedEvidence,
              ...(suggestedFix ? { suggestedFix } : {})
            });
            logger.info(
              { tenantId, poId: state.poId, reviewId, evidenceCount: mergedEvidence.length },
              "ExceptionAgent: Updated concurrently created open review ticket with merged evidence"
            );
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
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
