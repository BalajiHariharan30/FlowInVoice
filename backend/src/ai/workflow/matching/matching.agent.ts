import { WorkflowState, MatchedLineItem } from "../state.js";
import { AgentTools } from "../../../tools/index.js";
import {
  CustomerRepository,
  PurchaseOrderRepository,
  AuditRepository
} from "../../../repositories/index.js";
import { logger } from "../../../utils/logger.js";

/**
 * Agent 2: Matching Agent (100% Deterministic TypeScript)
 * Resolves customer master record and product catalog SKU data.
 */
export function createMatchingNode(tenantId: string) {
  return async (state: WorkflowState): Promise<Partial<WorkflowState>> => {
    logger.info({ tenantId, poId: state.poId }, "MatchingAgent: Resolving master entities");
    const startTime = Date.now();

    const customerName = state.extractedData?.customerName || state.customerName || "Default Customer";

    // 1. Resolve Customer Master
    const customerRes = await AgentTools.getCustomer(
      tenantId,
      customerName,
      state.extractedData?.gstNumber
    );

    if (customerRes?.ambiguous) {
      const candidateList = customerRes.candidates
        .map((c) => `${c.name} (GSTIN: ${c.gstNumber || "N/A"})`)
        .join(", ");
      const ambiguityError = `CUSTOMER_AMBIGUITY: Multiple distinct customer records (${customerRes.candidates.length}) match "${customerName}". Candidate GSTINs: [${candidateList}]. Manual customer disambiguation required.`;
      logger.warn({ tenantId, poId: state.poId, candidates: customerRes.candidates }, ambiguityError);

      return {
        validationErrors: [ambiguityError],
        isBusinessException: true,
        currentStep: "matching"
      };
    }

    let customer = customerRes?.customer || null;
    if (!customer) {
      customer = await CustomerRepository.create(tenantId, {
        name: customerName,
        code: customerName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8),
        email: "billing@" + customerName.toLowerCase().replace(/\s+/g, "") + ".com",
        gstNumber: state.extractedData?.gstNumber || "27AABCU9603R1ZM",
        paymentTerms: state.extractedData?.paymentTerms || "NET_30",
        currency: state.extractedData?.currency || "USD"
      });
      logger.info({ tenantId, customerId: customer._id.toString() }, "Auto-provisioned customer master record");
    }

    const customerId = customer._id.toString();

    // 2. Resolve Product Catalog Prices for Line Items
    const lineItems = state.extractedData?.lineItems || [];
    const matchedLineItems: MatchedLineItem[] = [];

    const uncatalogedThreshold = Number(process.env.UNCATALOGED_SKU_THRESHOLD) || 1000;
    const errors: string[] = [];
    let requiresCatalogReview = false;

    for (const item of lineItems) {
      let catalogPrice = await AgentTools.getProductPrice(tenantId, item.productCode);
      const isUncataloged = catalogPrice === null;
      let autoAcceptedNewSku = false;

      if (isUncataloged) {
        const lineTotal = item.lineTotal || (item.quantity * item.unitPrice);
        if (lineTotal >= uncatalogedThreshold) {
          requiresCatalogReview = true;
          const msg = `Uncataloged SKU ${item.productCode} (line total $${lineTotal}) meets/exceeds new product catalog review threshold ($${uncatalogedThreshold}). Escalating for catalog review.`;
          errors.push(msg);
        } else {
          autoAcceptedNewSku = true;
          catalogPrice = item.unitPrice;
        }
      }

      const variance = catalogPrice !== null
        ? AgentTools.calculateVariance(item.unitPrice, catalogPrice)
        : { variancePercentage: 100, isMatch: false };

      matchedLineItems.push({
        lineNumber: item.lineNumber,
        productCode: item.productCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        taxRate: item.taxRate,
        catalogPrice: catalogPrice !== null ? catalogPrice : 0,
        variancePercentage: variance.variancePercentage,
        isMatch: !isUncataloged && variance.isMatch,
        requiresCatalogReview: isUncataloged && requiresCatalogReview,
        autoAcceptedNewSku
      });
    }

    // Update PO with customer ID
    await PurchaseOrderRepository.updateExtraction(tenantId, state.poId, {
      customerId,
      customerName: customer.name
    });

    const latency = Date.now() - startTime;
    await AuditRepository.create(tenantId, {
      agentName: "MatchingAgent",
      action: "MATCH_ENTITIES",
      status: requiresCatalogReview ? "EXCEPTION" : "SUCCESS",
      entityId: state.poId,
      workflowId: state.workflowId,
      latency,
      summary: `Matched customer ${customer.name} and resolved ${matchedLineItems.length} catalog items`
    });

    return {
      customerId,
      customerName: customer.name,
      matchedLineItems,
      validationErrors: errors,
      isBusinessException: requiresCatalogReview,
      requiresCatalogReview,
      currentStep: "matching"
    };
  };
}
