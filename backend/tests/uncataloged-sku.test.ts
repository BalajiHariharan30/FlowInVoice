import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CustomerRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";

describe("STEP 5 (MEDIUM) — Uncataloged SKUs Must Not Auto-Pass", () => {
  const tenantId = "tenant_uncataloged_test";

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("flags uncataloged SKU exceeding $1,000 threshold for catalog review rather than auto-approving at 0% variance", async () => {
    // 1. Create customer
    const customer = await CustomerRepository.create(tenantId, {
      name: "Enterprise Buyer Corp",
      code: "ENTBUYER",
      gstNumber: "27AABCU9603R1ZM",
      currency: "USD"
    });

    // 2. Ingest PO with GHOST-SKU-999 at $1,000,000 (absent from product catalog)
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-GHOST-SKU-01",
      customerName: "Enterprise Buyer Corp",
      customerId: customer._id.toString(),
      gstNumber: "27AABCU9603R1ZM",
      currency: "USD",
      status: "EXTRACTED",
      s3Key: "pos/ghost_sku.pdf",
      documentName: "ghost_sku.pdf",
      documentSize: 2048,
      contentType: "application/pdf",
      subtotal: 1000000,
      tax: 0,
      discount: 0,
      totalAmount: 1000000,
      extractionConfidence: 1.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "GHOST-SKU-999",
          description: "Unregistered Industrial Turbine Component",
          quantity: 1,
          unitPrice: 1000000,
          lineTotal: 1000000,
          taxRate: 0
        }
      ]
    });

    const poId = po._id.toString();

    // 3. Run the orchestration workflow
    const result = await runOrchestrationWorkflow(tenantId, poId);

    // 4. Must halt at exception / human review for catalog review
    expect(result.isBusinessException).toBe(true);
    expect(result.currentStep).toBe("exception");

    const hasCatalogReviewError = result.validationErrors.some((err: string) =>
      err.includes("GHOST-SKU-999") && err.includes("catalog review")
    );
    expect(hasCatalogReviewError).toBe(true);

    // Verify invoice was not generated
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });
});
