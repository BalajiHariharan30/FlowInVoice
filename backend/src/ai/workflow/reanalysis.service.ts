import { PurchaseOrderRepository, CustomerRepository, AuditRepository } from "../../repositories/index.js";
import { AgentTools } from "../../tools/index.js";
import { MoneyUtil } from "../../utils/money.js";
import { DiscrepancyItem, EvidenceItem } from "../../types/index.js";
import { logger } from "../../utils/logger.js";

export interface ReanalysisResult {
  poId: string;
  discrepancies: DiscrepancyItem[];
  evidence: EvidenceItem[];
  allNodesPassed: boolean;
}

// Statutory 15-character Indian GSTIN Regex: 2 digits (State Code) + 5 letters (PAN) + 4 digits + 1 letter + 1 char + 'Z' + 1 char
const STATUTORY_GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export class ReanalysisService {
  /**
   * Re-analyzes a Purchase Order across the full validation pipeline (Nodes 02–06):
   * Node 02: Extraction Confidence Check
   * Node 03: SKU / Catalog Matching & Duplicate Check
   * Node 04: Math Parity Validation (Decimal.js)
   * Node 05: Contract RAG & Pricing Variance Check
   * Node 06: Tax & Statutory GSTIN Compliance Check
   *
   * Collects ALL discrepancies across all nodes without early-exit.
   */
  static async reanalyzePurchaseOrder(tenantId: string, poId: string): Promise<ReanalysisResult> {
    logger.info({ tenantId, poId }, "ReanalysisService: Starting full pipeline re-analysis across Nodes 02-06");

    const po = await PurchaseOrderRepository.findById(tenantId, poId);
    if (!po) {
      throw new Error(`Purchase order ${poId} not found for tenant ${tenantId}`);
    }

    const discrepancies: DiscrepancyItem[] = [];
    const evidenceList: EvidenceItem[] = [];

    // Resolve Customer master for checks
    let customer = null;
    if (po.customerId) {
      customer = await CustomerRepository.findById(tenantId, po.customerId);
    }
    if (!customer && po.customerName) {
      customer = await AgentTools.getCustomer(tenantId, po.customerName);
    }

    // -------------------------------------------------------------
    // NODE 02: Extraction Confidence Check
    // -------------------------------------------------------------
    const confidence = po.extractionConfidence ?? 1.0;
    if (confidence < 0.75) {
      discrepancies.push({
        nodeId: "02_EXTRACTION_CONFIDENCE",
        field: "extractionConfidence",
        expectedValue: ">= 75.0%",
        extractedValue: `${(confidence * 100).toFixed(1)}%`,
        severity: "HIGH",
        message: `Extraction confidence is ${(confidence * 100).toFixed(1)}%, below the required 75.0% threshold`
      });
    }

    // -------------------------------------------------------------
    // NODE 03: SKU Matching & Duplicate Check
    // -------------------------------------------------------------
    // Check Duplicate PO
    const isDuplicate = await AgentTools.checkDuplicatePO(tenantId, po.poNumber, po._id ? po._id.toString() : po.id);
    if (isDuplicate) {
      discrepancies.push({
        nodeId: "03_SKU_MATCHING",
        field: "poNumber",
        expectedValue: "Unique PO Number",
        extractedValue: po.poNumber,
        severity: "CRITICAL",
        message: `Duplicate PO number "${po.poNumber}" detected in tenant records`
      });
    }

    // Check SKU existence in master product catalog
    for (const item of po.lineItems || []) {
      const catalogPrice = await AgentTools.getProductPrice(tenantId, item.productCode);
      if (catalogPrice === null) {
        discrepancies.push({
          nodeId: "03_SKU_MATCHING",
          field: `lineItems[${item.lineNumber}].productCode`,
          expectedValue: "Registered Catalog SKU",
          extractedValue: item.productCode,
          severity: "MEDIUM",
          message: `SKU "${item.productCode}" on line ${item.lineNumber} is not found in master product catalog`
        });
      }
    }

    // -------------------------------------------------------------
    // NODE 04: Math Parity Validation (Decimal.js zero-tolerance)
    // -------------------------------------------------------------
    let calcSubtotal = MoneyUtil.from(0);
    for (const item of po.lineItems || []) {
      const lineMath = MoneyUtil.multiply(item.quantity, item.unitPrice);
      const isLineValid = MoneyUtil.equals(lineMath, item.lineTotal);
      if (!isLineValid) {
        discrepancies.push({
          nodeId: "04_MATH_VALIDATION",
          field: `lineItems[${item.lineNumber}].lineTotal`,
          expectedValue: lineMath.toNumber(),
          extractedValue: item.lineTotal,
          severity: "HIGH",
          message: `Line ${item.lineNumber} calculation mismatch: ${item.quantity} × ${item.unitPrice} = ${lineMath.toFixed(2)}, but extracted line total is ${item.lineTotal}`
        });
      }
      calcSubtotal = calcSubtotal.plus(lineMath);
    }

    // Subtotal vs sum of line items
    if (!MoneyUtil.equals(calcSubtotal, po.subtotal)) {
      discrepancies.push({
        nodeId: "04_MATH_VALIDATION",
        field: "subtotal",
        expectedValue: calcSubtotal.toNumber(),
        extractedValue: po.subtotal,
        severity: "HIGH",
        message: `Subtotal mismatch: line items sum to ${calcSubtotal.toFixed(2)}, but recorded subtotal is ${po.subtotal}`
      });
    }

    // Grand total = subtotal + tax - discount
    const expectedGrandTotal = MoneyUtil.calculateTotal(po.subtotal, po.tax, po.discount);
    if (!MoneyUtil.equals(expectedGrandTotal, po.totalAmount)) {
      discrepancies.push({
        nodeId: "04_MATH_VALIDATION",
        field: "totalAmount",
        expectedValue: expectedGrandTotal.toNumber(),
        extractedValue: po.totalAmount,
        severity: "HIGH",
        message: `Grand total mismatch: expected ${expectedGrandTotal.toFixed(2)} (subtotal ${po.subtotal} + tax ${po.tax} - discount ${po.discount || 0}), but extracted total is ${po.totalAmount}`
      });
    }

    // -------------------------------------------------------------
    // NODE 05: Contract RAG & Commercial Variance Check
    // -------------------------------------------------------------
    for (const item of po.lineItems || []) {
      const catalogPrice = (await AgentTools.getProductPrice(tenantId, item.productCode)) ?? 1000.0;
      const variance = AgentTools.calculateVariance(item.unitPrice, catalogPrice);

      if (!variance.isMatch) {
        let coveredByContract = false;

        // Step A: Search customer contract clauses
        if (po.customerId || customer?._id) {
          const custId = po.customerId || customer!._id.toString();
          const contractClauses = await AgentTools.searchContractClauses(
            tenantId,
            custId,
            `negotiated price discount tier for ${item.productCode} or ${item.description}`
          );

          if (contractClauses && contractClauses.length > 0) {
            evidenceList.push(...contractClauses);
            coveredByContract = true;
          }
        }

        if (!coveredByContract) {
          // Step B: Search corporate policy clauses
          const policyClauses = await AgentTools.searchPolicyClauses(
            tenantId,
            "pricing variance tolerance approval limit for purchase orders"
          );
          if (policyClauses && policyClauses.length > 0) {
            evidenceList.push(...policyClauses);
          }

          // Strict Policy threshold: max 10% allowable variance
          const allowedVariance = 10.0;
          if (variance.variancePercentage > allowedVariance) {
            discrepancies.push({
              nodeId: "05_CONTRACT_RAG",
              field: `lineItems[${item.lineNumber}].unitPrice`,
              expectedValue: catalogPrice,
              extractedValue: item.unitPrice,
              sourceClause: "Corporate Procurement Policy §4.2 (Max 10% Deviation)",
              severity: "HIGH",
              message: `Item ${item.productCode} unit price ${item.unitPrice} deviates ${variance.variancePercentage}% from catalog base price ${catalogPrice}, exceeding allowable threshold (${allowedVariance}%)`
            });
          }
        }
      }
    }

    // -------------------------------------------------------------
    // NODE 06: Tax & Statutory GSTIN Compliance Check
    // -------------------------------------------------------------
    const rawGstin = (po.gstNumber || "").trim().toUpperCase();

    // Check 1: Format validation against statutory GSTIN standard
    if (!rawGstin || !STATUTORY_GSTIN_REGEX.test(rawGstin)) {
      discrepancies.push({
        nodeId: "06_TAX_COMPLIANCE",
        field: "gstNumber",
        expectedValue: "Valid 15-character GSTIN (e.g., 27AABCU9603R1ZM)",
        extractedValue: po.gstNumber || "MISSING",
        sourceClause: "Indian Goods & Services Tax Act Section 22 / Rule 46",
        severity: "HIGH",
        message: `Invalid or missing GSTIN "${po.gstNumber || ""}". Must conform to statutory 15-character alphanumeric GSTIN format.`
      });
    }

    // Check 2: Customer master record consistency
    if (customer && customer.gstNumber) {
      const customerGstin = customer.gstNumber.trim().toUpperCase();
      if (rawGstin && customerGstin && rawGstin !== customerGstin) {
        discrepancies.push({
          nodeId: "06_TAX_COMPLIANCE",
          field: "gstNumber",
          expectedValue: customer.gstNumber,
          extractedValue: po.gstNumber,
          sourceClause: "Customer Master Tax Registry Alignment",
          severity: "HIGH",
          message: `PO GSTIN (${po.gstNumber}) does not match registered Customer Master GSTIN (${customer.gstNumber})`
        });
      }
    }

    logger.info(
      { tenantId, poId, discrepancyCount: discrepancies.length, evidenceCount: evidenceList.length },
      "ReanalysisService: Completed re-analysis"
    );

    return {
      poId,
      discrepancies,
      evidence: evidenceList,
      allNodesPassed: discrepancies.length === 0
    };
  }
}
