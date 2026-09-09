import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { AgentTools } from "../../tools/index.js";
import { EvidenceItem } from "../../types/index.js";

/**
 * Creates request-scoped LangChain tools strictly bound by closure to tenantId.
 * No tool accepts tenantId as an argument, completely neutralizing cross-tenant prompt injection.
 */
export function createWorkflowTools(tenantId: string) {
  const searchContractClausesTool = tool(
    async ({ customerId, query }: { customerId: string; query: string }) => {
      const results: EvidenceItem[] = await AgentTools.searchContractClauses(
        tenantId,
        customerId,
        query
      );
      if (!results || results.length === 0) {
        return JSON.stringify({
          message: "No contract data found for entity.",
          evidence: []
        });
      }
      return JSON.stringify({
        message: `Found ${results.length} contract clause(s)`,
        evidence: results
      });
    },
    {
      name: "searchContractClauses",
      description:
        "Searches vector knowledge base for negotiated contract clauses, rate sheets, and customer-specific discount tiers.",
      schema: z.object({
        customerId: z.string().describe("The customer ID governing the contract terms"),
        query: z.string().describe("Search query for rate sheets, line item pricing, or discounts")
      })
    }
  );

  const searchPolicyClausesTool = tool(
    async ({ query }: { query: string }) => {
      const results: EvidenceItem[] = await AgentTools.searchPolicyClauses(
        tenantId,
        query
      );
      if (!results || results.length === 0) {
        return JSON.stringify({
          message: "No policy data found for entity.",
          evidence: []
        });
      }
      return JSON.stringify({
        message: `Found ${results.length} policy clause(s)`,
        evidence: results
      });
    },
    {
      name: "searchPolicyClauses",
      description:
        "Searches corporate policy documents for allowable pricing variance tolerances, approval thresholds, and compliance guidelines.",
      schema: z.object({
        query: z.string().describe("Policy search query, e.g. price variance tolerance limits")
      })
    }
  );

  const getProductCatalogPriceTool = tool(
    async ({ productCode }: { productCode: string }) => {
      const price = await AgentTools.getProductPrice(tenantId, productCode);
      return JSON.stringify({
        productCode,
        catalogPrice: price !== null ? price : 1000.0,
        isDefaultSeeded: price === null
      });
    },
    {
      name: "getProductCatalogPrice",
      description: "Fetches official base catalog price for a product SKU.",
      schema: z.object({
        productCode: z.string().describe("Product SKU or code")
      })
    }
  );

  const checkDuplicatePOTool = tool(
    async ({ poNumber, currentPoId }: { poNumber: string; currentPoId?: string }) => {
      const isDuplicate = await AgentTools.checkDuplicatePO(tenantId, poNumber, currentPoId);
      return JSON.stringify({
        poNumber,
        isDuplicate
      });
    },
    {
      name: "checkDuplicatePO",
      description: "Checks if a purchase order number already exists for this tenant.",
      schema: z.object({
        poNumber: z.string().describe("The purchase order number to check"),
        currentPoId: z.string().optional().describe("Current PO document ID to exclude from match")
      })
    }
  );

  return {
    searchContractClausesTool,
    searchPolicyClausesTool,
    getProductCatalogPriceTool,
    checkDuplicatePOTool,
    allTools: [
      searchContractClausesTool,
      searchPolicyClausesTool,
      getProductCatalogPriceTool,
      checkDuplicatePOTool
    ]
  };
}
