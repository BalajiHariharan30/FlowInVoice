import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  InvoiceRepository,
  ReviewRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";

const app = createApp();

describe("STEP 1 (BLOCKER) — Arithmetic Invariance Under Human Approval", () => {
  const tenantId = "tenant_remediation";
  const reviewerToken = AuthService.generateTokens({
    id: "user_rev",
    tenantId,
    email: "reviewer@test.com",
    name: "Reviewer",
    role: "REVIEWER"
  }).accessToken;

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails validation and halts before posting when human reviewer submits invalid line item math (10 * 100 != 99999)", async () => {
    // 1. Create a PO in HUMAN_REVIEW status
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-MATH-FAIL-01",
      customerName: "Acme Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_REVIEW",
      s3Key: "pos/PO-MATH-FAIL-01.pdf",
      documentName: "PO-MATH-FAIL-01.pdf",
      documentSize: 2048,
      contentType: "application/pdf",
      subtotal: 1000,
      tax: 180,
      discount: 0,
      totalAmount: 1180,
      extractionConfidence: 0.60,
      lineItems: []
    });

    const poId = po._id.toString();

    // 2. Create pending review ticket for this PO
    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "Low OCR confidence on extraction",
      requestedByAgent: "ExtractionAgent"
    });

    const reviewId = review._id.toString();

    // 3. Reviewer submits resolve request with fat-fingered/invalid line math: 10 * 100 != 99999
    const resolveRes = await request(app)
      .post(`/api/v1/reviews/${reviewId}/resolve`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        decision: "APPROVED",
        resolutionNotes: "Reviewer manually inspected and approved with line corrections",
        correctedLineItems: [
          {
            lineNumber: 1,
            productCode: "WIDGET-X",
            description: "Industrial Widget",
            quantity: 10,
            unitPrice: 100,
            lineTotal: 99999, // Intentional arithmetic corruption
            taxRate: 18
          }
        ]
      });

    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe("APPROVED");

    // 4. Run the workflow for the approved PO
    const workflowResult = await runOrchestrationWorkflow(tenantId, poId);

    // 5. Verify arithmetic invariance is enforced: must be marked exception and NOT reach posting
    expect(workflowResult.isBusinessException).toBe(true);
    expect(workflowResult.validationErrors).toBeDefined();
    expect(workflowResult.validationErrors!.length).toBeGreaterThan(0);
    
    // Explicitly verify the exact mismatch was detected
    const mathMismatch = workflowResult.validationErrors!.some((err: string) =>
      err.includes("Line 1 math mismatch") && err.includes("99999")
    );
    expect(mathMismatch).toBe(true);

    // Verify invoice was NEVER generated or posted to ERP
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });
});
