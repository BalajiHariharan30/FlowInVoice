import {
  CustomerRepository,
  ContractRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  ProductRepository
} from "../repositories/index.js";
import { QdrantService } from "../rag/qdrant.service.js";
import { MoneyUtil } from "../utils/money.js";
import { EvidenceItem } from "../types/index.js";

export class AgentTools {
  static async getCustomer(tenantId: string, query: string) {
    if (!query) return null;
    const byCode = await CustomerRepository.findByCode(tenantId, query);
    if (byCode) return byCode;
    const byName = await CustomerRepository.findByName(tenantId, query);
    if (byName) return byName;
    const derivedCode = query.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
    if (derivedCode && derivedCode !== query) {
      return CustomerRepository.findByCode(tenantId, derivedCode);
    }
    return null;
  }

  static async getProduct(tenantId: string, sku: string) {
    return ProductRepository.findBySku(tenantId, sku);
  }

  static async getProductPrice(tenantId: string, sku: string): Promise<number | null> {
    const prod = await ProductRepository.findBySku(tenantId, sku);
    return prod ? prod.basePrice : null;
  }

  static async checkDuplicatePO(tenantId: string, poNumber: string, currentPoId?: string): Promise<boolean> {
    const existing = await PurchaseOrderRepository.findByPoNumber(tenantId, poNumber);
    if (!existing) return false;
    if (currentPoId && existing._id.toString() === currentPoId) return false;
    return true;
  }

  static async checkDuplicateInvoice(tenantId: string, invoiceNumber: string, currentInvoiceId?: string): Promise<boolean> {
    const existing = await InvoiceRepository.findByInvoiceNumber(tenantId, invoiceNumber);
    if (!existing) return false;
    if (currentInvoiceId && existing._id.toString() === currentInvoiceId) return false;
    return true;
  }

  static async getActiveContracts(tenantId: string, customerId: string) {
    return ContractRepository.findActiveContracts(tenantId, customerId);
  }

  static calculateVariance(actual: number, expected: number) {
    const diff = Math.abs(actual - expected);
    const variancePercent = expected > 0 ? (diff / expected) * 100 : 0;
    return {
      difference: diff,
      variancePercentage: MoneyUtil.toNumber(MoneyUtil.format(variancePercent, 2)),
      isMatch: MoneyUtil.equals(actual, expected)
    };
  }

  /**
   * Agentic Contract RAG Tool
   */
  static async searchContractClauses(
    tenantId: string,
    customerId: string,
    query: string
  ): Promise<EvidenceItem[]> {
    const results = await QdrantService.search(
      tenantId,
      query,
      { customerId, documentType: "CONTRACT" },
      3
    );

    return results.map((r) => ({
      sourceType: "CONTRACT",
      documentId: r.chunk.documentId,
      documentName: r.chunk.documentName,
      pageNumber: r.chunk.pageNumber,
      section: r.chunk.section,
      chunkId: r.chunk.chunkId,
      claim: r.chunk.content.substring(0, 300)
    }));
  }

  /**
   * Agentic Policy RAG Tool
   */
  static async searchPolicyClauses(
    tenantId: string,
    query: string
  ): Promise<EvidenceItem[]> {
    const results = await QdrantService.search(
      tenantId,
      query,
      { documentType: "POLICY" },
      3
    );

    return results.map((r) => ({
      sourceType: "POLICY",
      documentId: r.chunk.documentId,
      documentName: r.chunk.documentName,
      pageNumber: r.chunk.pageNumber,
      section: r.chunk.section,
      chunkId: r.chunk.chunkId,
      claim: r.chunk.content.substring(0, 300)
    }));
  }
}
