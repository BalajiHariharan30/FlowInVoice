import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createApp } from "../src/app.js";
import {
  ContractRepository,
  CustomerRepository,
  ProductRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { DocumentChunk } from "../src/rag/chunking.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";

const app = createApp();

describe("STEP 3 (HIGH) — Temporal Filtering on Contract RAG Retrieval", () => {
  const tenantId = "tenant_temporal_test";

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
    QdrantService.clearMockStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects auto-approval when only an expired contract clause exists for a high variance PO", async () => {
    // 1. Create Customer
    const customer = await CustomerRepository.create(tenantId, {
      name: "Global Tech Enterprises",
      code: "GLBTECH",
      gstNumber: "27AABCG1234F1Z1",
      currency: "USD"
    });
    const customerId = customer._id.toString();

    // 2. Create Base Product: Base price = $100
    await ProductRepository.create(tenantId, {
      sku: "SKU-TEMPORAL-1",
      name: "High Tech Widget",
      basePrice: 100
    });

    // 3. Create Expired Contract (Effective 2022 to 2023): Offered 50% discount ($50 unit price)
    const expiredContract = await ContractRepository.create(tenantId, {
      customerId,
      contractNumber: "CTR-EXPIRED-2023",
      effectiveFrom: new Date("2022-01-01T00:00:00Z"),
      effectiveTo: new Date("2023-12-31T23:59:59Z"),
      status: "EXPIRED",
      totalValue: 500000
    });

    // Index chunk for the expired contract
    const expiredChunk: DocumentChunk = {
      chunkId: `${expiredContract._id.toString()}-c1`,
      tenantId,
      documentId: expiredContract._id.toString(),
      documentName: "Master_Agreement_2022_2023.pdf",
      documentType: "CONTRACT",
      customerId,
      section: "Section 4. Negotiated Price & Discount Tier",
      pageNumber: 2,
      content: "Special negotiated price discount tier for SKU-TEMPORAL-1: 50% off base catalog price, unit price is $50.00."
    };
    await QdrantService.indexChunks([expiredChunk]);

    // 4. Submit a 2026 PO with unit price $50 (50% variance from $100 catalog price)
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-TEMPORAL-2026",
      customerName: "Global Tech Enterprises",
      customerId,
      gstNumber: "27AABCG1234F1Z1",
      currency: "USD",
      issueDate: new Date("2026-06-15T00:00:00Z"),
      status: "EXTRACTED",
      s3Key: "pos/po_temporal.pdf",
      documentName: "po_temporal.pdf",
      documentSize: 2048,
      contentType: "application/pdf",
      subtotal: 500,
      tax: 0,
      discount: 0,
      totalAmount: 500,
      extractionConfidence: 1.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-TEMPORAL-1",
          description: "High Tech Widget",
          quantity: 10,
          unitPrice: 50, // 50% variance against catalog price 100
          lineTotal: 500,
          taxRate: 0
        }
      ]
    });

    const poId = po._id.toString();

    // 5. Run the orchestration workflow
    const result = await runOrchestrationWorkflow(tenantId, poId);

    // 6. Must FAIL closed: because the 50% clause is in an expired contract, it must not auto-approve
    expect(result.isBusinessException).toBe(true);
    expect(result.currentStep).toBe("exception");
    expect(result.noActiveContract).toBe(true);

    // Verify invoice was NOT generated
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });
});
