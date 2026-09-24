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
    if (state.currentStep === "extraction" || state.currentStep === "intake") {
      stage = "extraction";
    } else if (state.currentStep === "posting" || state.currentStep === "invoice_gen" || state.currentStep === "invoice_verif") {
      stage = "invoice";
    } else {
      stage = "validation";
    }

    const previousReviews = await ReviewRepository.findByEntityId(tenantId, state.poId);
    const po = await PurchaseOrderRepository.findById(tenantId, state.poId);
    const totalErrorCount = previousReviews.length + (po?.retryCount || 0) + (state.validationErrors?.length || 1);
    const flagCount = state.validationErrors?.length || 0;
    const isMultiFlagException = flagCount > 3 || totalErrorCount >= 3;

    const isCritical =
      isMultiFlagException ||
      reason.toLowerCase().includes("duplicate") ||
      reason.toLowerCase().includes("math mismatch");
    const priority: ReviewPriority = isCritical ? "CRITICAL" : "HIGH";

    // Section 10: Once a PO accumulates >= 3 errors or > 3 validation flags, generate a structured suggestedFix diagnosis
    let suggestedFix: any = undefined;
    if (isMultiFlagException || previousReviews.length >= 2 || (po?.retryCount || 0) >= 2) {
      suggestedFix = generateDiagnosis(reason, totalErrorCount, state.validationErrors || []);
      logger.info(
        { tenantId, poId: state.poId, rootCauseCategory: suggestedFix.rootCauseCategory, flagCount },
        "ExceptionAgent: Generated structured suggestedFix diagnosis for multi-flag or repeated exceptions"
      );
    }

    // Bug 4 / Anti-Resurrection Protection:
    // If human approval was already granted AND the current stage has NO errors,
    // bypass re-creating a review and force-resume to posting.
    // If errors STILL exist (partial fix), we do NOT bypass — findOrUpdateStageReview
    // will reopen the existing approved review in place (never creates a duplicate).
    const hasAnyApprovedReview = previousReviews.some((r) => r.status === "APPROVED");
    const currentErrors = state.validationErrors || [];
    if ((hasAnyApprovedReview || state.isHumanApproved || po?.status === "HUMAN_APPROVED") && currentErrors.length === 0) {
      const existingApproved = previousReviews.find((r) => r.status === "APPROVED");
      logger.warn(
        { tenantId, poId: state.poId, reason, approvedReviewId: existingApproved?._id?.toString() },
        "ANTI_RESURRECTION: PO already has an approved review and no current errors. Bypassing review creation and force-resuming workflow to posting."
      );
      await AuditRepository.create(tenantId, {
        agentName: "ExceptionAgent",
        action: "DUPLICATE_EXCEPTION_AFTER_APPROVAL",
        status: "SUCCESS",
        entityId: state.poId,
        workflowId: state.workflowId,
        latency: Date.now() - startTime,
        summary: `ANTI_RESURRECTION: Bypassed review creation for already-approved PO with no current errors (${state.poId}). Resuming to posting.`
      });
      return {
        isBusinessException: false,
        validationErrors: [],
        isHumanApproved: true,
        currentStep: "posting",
        status: "HUMAN_APPROVED"
      };
    }

    // ── INVARIANT: One non-terminal review per (poId, stage) ─────────────────
    // findOrUpdateStageReview enforces this:
    //   • No existing review for this stage → CREATE new PENDING with findings[].
    //   • Non-terminal (PENDING/ESCALATED) exists → UPDATE in place: replace findings[], ++resumeAttempts.
    //   • APPROVED exists → REOPEN to PENDING: replace findings[], ++resumeAttempts, clear resolvedAt/By.
    // Never calls ReviewRepository.create() directly for stage reviews.
    const stageFindings = state.stageFindings || errors.map((msg, idx) => ({
      id: `${stage}:VALIDATION_ERROR:field_${idx}`,
      checkType: "VALIDATION_ERROR",
      field: "po_data",
      expected: "",
      actual: "",
      message: msg,
      resolved: false
    }));

    // Derive semantic expected/actual labels based on what kind of exception this is
    const isCatalogReview = stageFindings.some((f) => f.checkType === "UNCATALOGED_SKU_CHECK");
    const isExtractionReview = stage === "extraction";
    const expectedValue = isCatalogReview
      ? "All line items match cataloged products in inventory"
      : isExtractionReview
      ? "OCR extraction confidence ≥ 75%"
      : "Within contracted pricing & policy limits";
    const actualValue = isCatalogReview
      ? `${stageFindings.length} uncataloged SKU(s) require catalog approval`
      : isExtractionReview
      ? reason
      : `${stageFindings.length} policy/math violation(s) detected`;

    let reviewId: string;
    try {
      const review = await ReviewRepository.findOrUpdateStageReview(tenantId, {
        entity: "purchase_order",
        entityId: state.poId,
        stage,
        checkpointStep: state.currentStep,
        status: "PENDING",
        priority,
        reason,
        requestedByAgent: `FlowInvoice_${state.currentStep || "Workflow"}`,
        expectedValue,
        actualValue,
        evidence: state.evidence || [],
        findings: stageFindings as any,
        ...(suggestedFix ? { suggestedFix } : {})
      });
      reviewId = review._id.toString();
      logger.info(
        { tenantId, poId: state.poId, reviewId, findingCount: stageFindings.length, resumeAttempts: (review as any).resumeAttempts },
        "ExceptionAgent: Upserted stage review ticket"
      );
    } catch (err: any) {
      logger.error({ tenantId, poId: state.poId, err: err.message }, "ExceptionAgent: findOrUpdateStageReview failed");
      throw err;
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
      summary: `Workflow exception escalated to Review Center (${stage} stage): ${reason}. ${stageFindings.length} finding(s) stored.`
    });

    return {
      reviewId,
      status: "HUMAN_REVIEW",
      isBusinessException: true,
      currentStep: "exception"
    };
  };
}
