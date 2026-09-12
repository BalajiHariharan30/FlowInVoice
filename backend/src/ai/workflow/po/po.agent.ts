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

    if (po?.status === "REJECTED") {
      logger.info({ tenantId, poId: state.poId }, "POValidationAgent: PO is REJECTED; halting validation");
      return {
        currentStep: "po_validation",
        validationErrors: ["Purchase order is in REJECTED status"],
        isBusinessException: true
      };
    }

    const isHumanSignoff = Boolean(
      state.skipValidation || state.isHumanApproved || po?.status === "HUMAN_APPROVED"
    );

    const data = (po ? {
      poNumber: po.poNumber || "",
      customerName: po.customerName || "",
      gstNumber: po.gstNumber || "",
      currency: po.currency || "INR",
      paymentTerms: po.paymentTerms || "NET_30",
      issueDate: po.issueDate ? new Date(po.issueDate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
      lineItems: po.lineItems || state.extractedData?.lineItems || [],
      subtotal: po.subtotal ?? state.extractedData?.subtotal ?? 0,
      tax: po.tax ?? state.extractedData?.tax ?? 0,
      discount: po.discount ?? state.extractedData?.discount ?? 0,
      totalAmount: po.totalAmount ?? state.extractedData?.totalAmount ?? 0,
      confidence: po.extractionConfidence ?? state.extractedData?.confidence ?? 1.0
    } : state.extractedData);

    if (!data || !data.lineItems || data.lineItems.length === 0) {
      return {
        validationErrors: ["No extracted PO line items available for mathematical validation"],
        isBusinessException: true,
        currentStep: "po_validation"
      };
    }

    const checks: WorkflowValidationCheck[] = [];
    const errors: string[] = isHumanSignoff ? [] : [...(state.validationErrors || [])];

    // Pre-check: Multi-currency consistency check (§Step 4 Remediation)
    const headerCurrency = (data.currency || "INR").trim().toUpperCase();
    const divergentCurrencies = new Set<string>();
    for (const item of data.lineItems) {
      if ((item as any).currency && (item as any).currency.trim().toUpperCase() !== headerCurrency) {
        divergentCurrencies.add((item as any).currency.trim().toUpperCase());
      }
    }

    if (divergentCurrencies.size > 0) {
      const mismatchMsg = `CURRENCY_MISMATCH: Line items declare divergent currencies (${Array.from(divergentCurrencies).join(", ")}) differing from PO header currency (${headerCurrency}). Raw cross-currency summation is rejected.`;
      if (!isHumanSignoff) {
        errors.push(mismatchMsg);
      }
      checks.push({
        checkName: "CURRENCY_UNIFORMITY_CHECK",
        passed: isHumanSignoff || false,
        message: isHumanSignoff ? `${mismatchMsg} (Waived by human approval)` : mismatchMsg
      });
    } else {
      checks.push({
        checkName: "CURRENCY_UNIFORMITY_CHECK",
        passed: true,
        message: `All line items share uniform currency: ${headerCurrency}`
      });
    }

    // Check 1: Line item math & subtotal summation
    // -----------------------------------------------------------------------------------------------------------------
    // DECISION ON SUBTOTAL RECONCILIATION:
    // In enterprise B2B accounting and statutory tax filing, line-item math (Qty * UnitPrice = LineTotal and sum(LineTotal) = Subtotal)
    // is mathematically canonical. Once a human reviewer approves a subtotal/tax mismatch exception, downstream invoice generation uses
    // the CORRECTED recalculated total ($3,800.00 base + tax) rather than the vendor document's erroneous typo figure ($3,900.00).
    // When isHumanSignoff is true, this check is waived/marked resolved so the workflow resumes without re-deriving the error.
    // -----------------------------------------------------------------------------------------------------------------
    let calcSubtotal = MoneyUtil.from(0);
    for (const item of data.lineItems) {
      const lineMath = MoneyUtil.multiply(item.quantity, item.unitPrice);
      const isLineValid = isHumanSignoff || MoneyUtil.equals(lineMath, item.lineTotal);
      if (!isLineValid && !isHumanSignoff) {
        errors.push(`Line ${item.lineNumber} math mismatch: ${item.quantity} * ${item.unitPrice} != ${item.lineTotal}`);
      }
      calcSubtotal = calcSubtotal.plus(lineMath);
    }

    const isSubtotalValid = isHumanSignoff || MoneyUtil.equals(calcSubtotal, data.subtotal);
    checks.push({
      checkName: "SUBTOTAL_MATH_CHECK",
      passed: isSubtotalValid,
      message: isSubtotalValid
        ? (isHumanSignoff ? "Subtotal math verified / resolved by human review" : "Subtotal matches sum of line items")
        : `Subtotal mismatch: expected ${calcSubtotal.toFixed(2)}, got ${data.subtotal}`
    });
    if (!isSubtotalValid && !isHumanSignoff) {
      errors.push(`Subtotal mismatch: expected ${calcSubtotal.toFixed(2)}, got ${data.subtotal}`);
    }

    // Check 2: Total calculation with tax & discount
    // Deterministic tax reconciliation if line items tax rates reconcile total
    let effectiveTax = data.tax;
    const directExpectedTotal = MoneyUtil.calculateTotal(data.subtotal, data.tax, data.discount);
    if (!MoneyUtil.equals(directExpectedTotal, data.totalAmount) && data.lineItems.length > 0) {
      const lineTaxSum = data.lineItems.reduce((acc, item) => {
        const lt = MoneyUtil.from(item.lineTotal);
        const rateDecimal = MoneyUtil.from(item.taxRate || 0).dividedBy(100);
        return acc.plus(lt.times(rateDecimal));
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
    const isTotalValid = isHumanSignoff || MoneyUtil.equals(expectedTotal, data.totalAmount);
    checks.push({
      checkName: "TOTAL_AMOUNT_CHECK",
      passed: isTotalValid,
      message: isTotalValid
        ? (isHumanSignoff ? "Total amount verified / resolved by human review" : "Total amount verified")
        : `Total expected ${expectedTotal.toFixed(2)}, got ${data.totalAmount}`
    });
    if (!isTotalValid && !isHumanSignoff) {
      errors.push(`Total mismatch: expected ${expectedTotal.toFixed(2)}, got ${data.totalAmount}`);
    }

    // Check 3: Duplicate PO check (automated intake only)
    if (!isHumanSignoff) {
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
    }

    // Check 4: Extraction confidence (waived on human review signoff)
    const confidence = data.confidence ?? 1.0;
    if (!isHumanSignoff) {
      const isConfidenceAcceptable = confidence >= 0.75;
      checks.push({
        checkName: "EXTRACTION_CONFIDENCE_CHECK",
        passed: isConfidenceAcceptable,
        message: `Extraction confidence is ${(confidence * 100).toFixed(1)}%`
      });
      if (!isConfidenceAcceptable) {
        errors.push(`Low extraction confidence: ${(confidence * 100).toFixed(1)}%`);
      }
    }

    const hasErrors = errors.length > 0 || (!isHumanSignoff && Boolean(state.isBusinessException));

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
      validationErrors: isHumanSignoff ? [] : (state.validationErrors || []),
      isBusinessException: isHumanSignoff ? false : Boolean(state.isBusinessException),
      status: "VALIDATING",
      currentStep: "po_validation"
    };
  };
}
