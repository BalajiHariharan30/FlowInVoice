import { WorkflowState, WorkflowValidationCheck } from "../state.js";
import { MoneyUtil } from "../../../utils/money.js";
import { AgentTools } from "../../../tools/index.js";
import {
  ValidationResultRepository,
  AuditRepository,
  PurchaseOrderRepository,
  ReviewRepository
} from "../../../repositories/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Agent 3: PO Validation Agent (100% Deterministic TypeScript)
 * Validates mathematical integrity using Decimal.js and checks PO uniqueness.
 */
export function createPOValidationNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "POValidationAgent: Performing math and uniqueness checks");
    const startTime = Date.now();

    const po = await PurchaseOrderRepository.findById(tenantId, state.poId);

    // Human sign-off defense: stop treating human-approved PO as a fresh input
    if (state.skipValidation || state.isHumanApproved || po?.status === "HUMAN_APPROVED" || po?.status === "REJECTED") {
      logger.info({ tenantId, poId: state.poId, status: po?.status }, "POValidationAgent: Human review sign-off active; bypassing automated checks");
      return {
        currentStep: "po_validation",
        validationErrors: [],
        isBusinessException: false
      };
    }

    const data = state.extractedData;
    if (!data) {
      return {
        validationErrors: ["No extracted PO data available for mathematical validation"],
        isBusinessException: true,
        currentStep: "po_validation"
      };
    }

    const checks: WorkflowValidationCheck[] = [];
    const errors: string[] = [];

    // Check 1: Line item math & subtotal summation
    let calcSubtotal = MoneyUtil.from(0);
    for (const item of data.lineItems) {
      const lineMath = MoneyUtil.multiply(item.quantity, item.unitPrice);
      const isLineValid = MoneyUtil.equals(lineMath, item.lineTotal);
      if (!isLineValid) {
        errors.push(`Line ${item.lineNumber} math mismatch: ${item.quantity} * ${item.unitPrice} != ${item.lineTotal}`);
      }
      calcSubtotal = calcSubtotal.plus(lineMath);
    }

    const isSubtotalValid = MoneyUtil.equals(calcSubtotal, data.subtotal);
    checks.push({
      checkName: "SUBTOTAL_MATH_CHECK",
      passed: isSubtotalValid,
      message: isSubtotalValid
        ? "Subtotal matches sum of line items"
        : `Subtotal mismatch: expected ${calcSubtotal.toFixed(2)}, got ${data.subtotal}`
    });
    if (!isSubtotalValid) {
      errors.push(`Subtotal mismatch: expected ${calcSubtotal.toFixed(2)}, got ${data.subtotal}`);
    }

    // Check 2: Total calculation with tax & discount
    // Deterministic tax reconciliation if line items tax rates reconcile total
    let effectiveTax = data.tax;
    const directExpectedTotal = MoneyUtil.calculateTotal(data.subtotal, data.tax, data.discount);
    if (!MoneyUtil.equals(directExpectedTotal, data.totalAmount) && data.lineItems.length > 0) {
      const lineTaxSum = data.lineItems.reduce((acc, item) => {
        const lt = MoneyUtil.from(item.lineTotal);
        const rate = (item.taxRate || 0) / 100;
        return acc.plus(lt.times(rate));
      }, MoneyUtil.from(0));

      const lineTaxExpectedTotal = MoneyUtil.calculateTotal(data.subtotal, lineTaxSum, data.discount);
      if (MoneyUtil.equals(lineTaxExpectedTotal, data.totalAmount)) {
        logger.info({ tenantId, poId: state.poId }, "POValidationAgent: Reconciled tax from line items tax rates");
        effectiveTax = MoneyUtil.toNumber(lineTaxSum);
        data.tax = effectiveTax;
        await PurchaseOrderRepository.updateExtraction(tenantId, state.poId, { tax: effectiveTax });
      }
    }

    const expectedTotal = MoneyUtil.calculateTotal(data.subtotal, effectiveTax, data.discount);
    const isTotalValid = MoneyUtil.equals(expectedTotal, data.totalAmount);
    checks.push({
      checkName: "TOTAL_AMOUNT_CHECK",
      passed: isTotalValid,
      message: isTotalValid
        ? "Total amount verified"
        : `Total expected ${expectedTotal.toFixed(2)}, got ${data.totalAmount}`
    });
    if (!isTotalValid) {
      errors.push(`Total mismatch: expected ${expectedTotal.toFixed(2)}, got ${data.totalAmount}`);
    }

    // Check 3: Duplicate PO check
    const isDuplicate = await AgentTools.checkDuplicatePO(tenantId, data.poNumber, state.poId);
    checks.push({
      checkName: "DUPLICATE_PO_CHECK",
      passed: !isDuplicate,
      message: isDuplicate
        ? `Duplicate PO number ${data.poNumber} detected for tenant`
        : "PO number is unique"
    });
    if (isDuplicate) {
      errors.push(`Duplicate PO number: ${data.poNumber}`);
    }

    // Check 4: Extraction confidence
    const confidence = data.confidence ?? 1.0;
    const isConfidenceAcceptable = confidence >= 0.75;
    checks.push({
      checkName: "EXTRACTION_CONFIDENCE_CHECK",
      passed: isConfidenceAcceptable,
      message: `Extraction confidence is ${(confidence * 100).toFixed(1)}%`
    });
    if (!isConfidenceAcceptable) {
      errors.push(`Low extraction confidence: ${(confidence * 100).toFixed(1)}%`);
    }

    const hasErrors = errors.length > 0;

    await ValidationResultRepository.create(tenantId, {
      poId: state.poId,
      stage: "extraction",
      status: hasErrors ? "FAILED" : "PASSED",
      checks,
      confidence,
      validationErrors: errors
    });

    const latency = Date.now() - startTime;

    if (hasErrors) {
      logger.warn({ tenantId, poId: state.poId, errors }, "POValidationAgent: Validation failed with errors");
      await AuditRepository.create(tenantId, {
        agentName: "POVerificationAgent",
        action: "VERIFICATION_FAILED",
        status: "FAILURE",
        entityId: state.poId,
        workflowId: state.workflowId,
        latency,
        summary: `Verification failed with ${errors.length} error(s): ${errors[0]}`
      });
      return {
        validationChecks: checks,
        validationErrors: errors,
        isBusinessException: true,
        currentStep: "po_validation"
      };
    }

    await PurchaseOrderRepository.updateStatus(tenantId, state.poId, "VALIDATING");
    await AuditRepository.create(tenantId, {
      agentName: "POVerificationAgent",
      action: "VERIFICATION_PASSED",
      status: "SUCCESS",
      entityId: state.poId,
      workflowId: state.workflowId,
      latency,
      summary: "Mathematical, duplicate, and confidence verification passed successfully"
    });

    return {
      validationChecks: checks,
      validationErrors: [],
      isBusinessException: false,
      status: "VALIDATING",
      currentStep: "po_validation"
    };
  };
}
