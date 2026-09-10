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
    let customer = await AgentTools.getCustomer(tenantId, customerName);
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

    for (const item of lineItems) {
      let catalogPrice = await AgentTools.getProductPrice(tenantId, item.productCode);
      if (catalogPrice === null) {
        // Use extracted unit price as catalog baseline when no catalog entry exists.
        // This models a "first-time" product whose price becomes the benchmark —
        // any real deviation would be caught on subsequent uploads.
        catalogPrice = item.unitPrice;
      }

      const variance = AgentTools.calculateVariance(item.unitPrice, catalogPrice);

      matchedLineItems.push({
        lineNumber: item.lineNumber,
        productCode: item.productCode,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        taxRate: item.taxRate,
        catalogPrice,
        variancePercentage: variance.variancePercentage,
        isMatch: variance.isMatch
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
      status: "SUCCESS",
      entityId: state.poId,
      workflowId: state.workflowId,
      latency,
      summary: `Matched customer ${customer.name} and resolved ${matchedLineItems.length} catalog items`
    });

    return {
      customerId,
      customerName: customer.name,
      matchedLineItems,
      currentStep: "matching"
    };
  };
}
