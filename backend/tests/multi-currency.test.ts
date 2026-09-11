import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  PurchaseOrderRepository,
  InvoiceRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";

describe("STEP 4 (HIGH) — Reject Silent Multi-Currency Summation", () => {
  const tenantId = "tenant_currency_test";

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes to Exception with CURRENCY_MISMATCH when line items have mixed currencies", async () => {
    // Submit a PO with Line 1 = USD 100, Line 2 = INR 8300, header currency = INR
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-MULTI-CURR-01",
      customerName: "Cross Border Imports Ltd",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR", // Header currency is INR
      status: "EXTRACTED",
      s3Key: "pos/multi_curr.pdf",
      documentName: "multi_curr.pdf",
      documentSize: 2048,
      contentType: "application/pdf",
      subtotal: 8400, // Flawed direct summation (100 USD + 8300 INR)
      tax: 0,
      discount: 0,
      totalAmount: 8400,
      extractionConfidence: 1.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-USD-ITEM",
          description: "US Import License",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
          taxRate: 0,
          currency: "USD" // Divergent currency!
        },
        {
          lineNumber: 2,
          productCode: "SKU-INR-ITEM",
          description: "Local Handling Fee",
          quantity: 1,
          unitPrice: 8300,
          lineTotal: 8300,
          taxRate: 0,
          currency: "INR"
        }
      ]
    });

    const poId = po._id.toString();

    // Run the orchestration workflow
    const result = await runOrchestrationWorkflow(tenantId, poId);

    // Must halt with business exception
    expect(result.isBusinessException).toBe(true);
    expect(result.currentStep).toBe("exception");

    // Must have explicit CURRENCY_MISMATCH validation error
    const hasCurrencyMismatch = result.validationErrors.some((err: string) =>
      err.includes("CURRENCY_MISMATCH") && err.includes("USD")
    );
    expect(hasCurrencyMismatch).toBe(true);

    // Invariant: No invoice generated or posted with flawed numbers
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });
});
