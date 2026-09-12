import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  ProductRepository,
  CustomerRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { MoneyUtil } from "../src/utils/money.js";

function generateAuthToken(tenantId: string, userId: string = "usr_reviewer_1", email: string = "reviewer@enterprise.com"): string {
  return AuthService.generateTokens({
    id: userId,
    tenantId,
    email,
    role: "REVIEWER",
    name: "Reviewer User"
  }).accessToken;
}

describe("Validation Review Approval & Resume Loop Verification", () => {
  const tenantId = "tenant_val_resume_test";
  const app = createApp();

  beforeEach(async () => {
    clearTestRepositories();
    resetWorkflowRateLimiter();

    // Seed customer and catalog product so matching passes cleanly without catalog review exception
    await CustomerRepository.create(tenantId, {
      name: "Acme Industrial Corp",
      code: "ACMEIND",
      email: "billing@acmeindustrial.com",
      gstNumber: "27AATCS1234M1Z5",
      paymentTerms: "NET_30",
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-VAL-01",
      name: "Precision Sensor Node",
      basePrice: 1900,
      currency: "INR"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should halt on subtotal mismatch, approve review, resume forward to COMPLETED, create zero duplicate reviews, and calculate invoice using canonical line item math", async () => {
    const reviewerToken = generateAuthToken(tenantId, "usr_reviewer_ind", "reviewer@enterprise.com");

    // 1. Ingest a PO where line items sum to 3800 (2 x 1900), but stated subtotal is 3900 (mismatch)
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-MATH-MISMATCH-001",
      customerName: "Acme Industrial Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 3900, // Document mistakenly stated 3900
      tax: 684,       // 18% of 3800 is 684
      discount: 0,
      totalAmount: 4584,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-VAL-01",
          description: "Precision Sensor Node",
          quantity: 2,
          unitPrice: 1900,
          lineTotal: 3800,
          taxRate: 18
        }
      ]
    });
    const poId = po._id.toString();

    // 2. Run initial workflow -> Must encounter PO Validation math exception and halt at HUMAN_REVIEW
    const initialResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(initialResult.isBusinessException).toBe(true);
    expect(initialResult.status).toBe("HUMAN_REVIEW");

    // Verify PO status and initial review ticket
    const poAfterHalt = await PurchaseOrderRepository.findById(tenantId, poId);
    expect(poAfterHalt?.status).toBe("HUMAN_REVIEW");

    const reviewsBeforeApproval = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviewsBeforeApproval.length).toBe(1);
    const reviewTicket = reviewsBeforeApproval[0];
    expect(reviewTicket.status).toBe("PENDING");
    expect(reviewTicket.reason).toContain("Subtotal mismatch");

    // 3. Reviewer approves the validation exception via API
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${reviewTicket._id.toString()}/approve`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        resolutionNotes: "Subtotal math approved and reconciled to line item sum ($3,800.00)"
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    // 4. Wait / run workflow resume (simulate asynchronous resumption or direct invocation)
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeResult.isBusinessException).toBe(false);
    expect(resumeResult.validationErrors.length).toBe(0);
    expect(resumeResult.invoiceNumber).toBeDefined();

    // 5. Invariant A: Exactly ONE review ticket must exist in the DB (ZERO duplicate tickets created)
    const allReviewsAfterResume = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviewsAfterResume.length).toBe(1);
    expect(allReviewsAfterResume[0].status).toBe("APPROVED");

    // 6. Invariant B: PO status must be COMPLETED
    const finalPo = await PurchaseOrderRepository.findById(tenantId, poId);
    expect(finalPo?.status).toBe("COMPLETED");

    // 7. Invariant C: Generated invoice must use CANONICAL line item math (3800 + 684 = 4484), NOT 3900
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).not.toBeNull();
    expect(invoice?.status).toBe("ISSUED");
    expect(invoice?.subtotal).toBe(3800);
    expect(invoice?.tax).toBe(684);
    expect(invoice?.totalAmount).toBe(4484); // 3800 + 684, NOT 3900 + 684 (4584)

    // 8. Invariant D: Subsequent executions are completely idempotent
    const idempotentResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(idempotentResult.status).toBe("COMPLETED");
    expect(idempotentResult.isBusinessException).toBe(false);

    const reviewsFinalCheck = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviewsFinalCheck.length).toBe(1);
  });
});
