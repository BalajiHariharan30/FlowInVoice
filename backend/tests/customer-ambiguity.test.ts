import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CustomerRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";

describe("STEP 6 (MEDIUM) — Ambiguous Customer Match Escalation", () => {
  const tenantId = "tenant_customer_ambiguity";

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes to Exception and reports candidate GSTINs when customer name matches multiple customer records", async () => {
    // 1. Create two distinct customers both named "Acme Corp" with different GSTINs & codes
    await CustomerRepository.create(tenantId, {
      name: "Acme Corp",
      code: "ACME-MH",
      gstNumber: "27AABCA1111A1Z1",
      currency: "INR"
    });

    await CustomerRepository.create(tenantId, {
      name: "Acme Corp",
      code: "ACME-KA",
      gstNumber: "29AABCA2222B1Z2",
      currency: "INR"
    });

    // 2. Ingest PO for "Acme Corp" with an ambiguous or blank GSTIN
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-AMBIGUOUS-CUST-01",
      customerName: "Acme Corp",
      gstNumber: "", // Unspecified GSTIN
      currency: "INR",
      status: "EXTRACTED",
      s3Key: "pos/ambiguous_cust.pdf",
      documentName: "ambiguous_cust.pdf",
      documentSize: 2048,
      contentType: "application/pdf",
      subtotal: 100,
      tax: 0,
      discount: 0,
      totalAmount: 100,
      extractionConfidence: 1.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-ITEM-1",
          description: "Office Paper",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
          taxRate: 0
        }
      ]
    });

    const poId = po._id.toString();

    // 3. Run the orchestration workflow
    const result = await runOrchestrationWorkflow(tenantId, poId);

    // 4. Must halt at exception with customer ambiguity
    expect(result.isBusinessException).toBe(true);
    expect(result.currentStep).toBe("exception");

    const hasAmbiguityError = result.validationErrors.some(
      (err: string) =>
        err.includes("CUSTOMER_AMBIGUITY") &&
        err.includes("27AABCA1111A1Z1") &&
        err.includes("29AABCA2222B1Z2")
    );
    expect(hasAmbiguityError).toBe(true);

    // Invariant: No invoice generated
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });
});
