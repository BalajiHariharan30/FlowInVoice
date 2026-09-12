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

describe("Validation Review Approval & Resume Loop Verification (PO_With_3_Errors Fixture)", () => {
  const tenantId = "tenant_val_resume_fixture_test";
  const app = createApp();

  beforeEach(async () => {
    clearTestRepositories();
    resetWorkflowRateLimiter();

    // Seed customer and catalog products
    await CustomerRepository.create(tenantId, {
      name: "Acme Enterprise Supplies",
      code: "ACMESUPP",
      email: "accounts@acmesupplies.com",
      gstNumber: "27AATCS1234M1Z5",
      paymentTerms: "NET_30",
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-A4-PAPER",
      name: "A4 Paper Ream (75 GSM)",
      basePrice: 250,
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-BALL-PEN",
      name: "Ballpoint Pen Pack",
      basePrice: 12,
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-DOC-FOLDER",
      name: "Document Display Folder",
      basePrice: 35,
      currency: "INR"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should halt on subtotal mismatch (3800 vs 3900), approve Ticket #1, resume to COMPLETED, spawn zero duplicate tickets, and generate invoice using corrected 3800 + tax total", async () => {
    const reviewerToken = generateAuthToken(tenantId, "usr_reviewer_ind", "reviewer@enterprise.com");

    // 1. Ingest PO with line items:
    // - A4 Paper: 10 * 250 = 2500
    // - Pen: 50 * 12 = 600
    // - Folder: 20 * 35 = 700
    // Sum of line items = 3800. Stated subtotal in document header = 3900 (mismatch).
    // Tax = CGST 9% (342) + SGST 9% (342) = 684 (computed on canonical 3800 base).
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-3ERRORS-SUBTOTAL-001",
      customerName: "Acme Enterprise Supplies",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 3900, // Erroneous stated figure on document
      tax: 684,       // CGST 9% + SGST 9% on 3800 base
      discount: 0,
      totalAmount: 4584,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-A4-PAPER",
          description: "A4 Paper Ream (75 GSM)",
          quantity: 10,
          unitPrice: 250,
          lineTotal: 2500,
          taxRate: 18
        },
        {
          lineNumber: 2,
          productCode: "SKU-BALL-PEN",
          description: "Ballpoint Pen Pack",
          quantity: 50,
          unitPrice: 12,
          lineTotal: 600,
          taxRate: 18
        },
        {
          lineNumber: 3,
          productCode: "SKU-DOC-FOLDER",
          description: "Document Display Folder",
          quantity: 20,
          unitPrice: 35,
          lineTotal: 700,
          taxRate: 18
        }
      ]
    });
    const poId = po._id.toString();

    // 2. Initial execution flags the mismatch and halts at HUMAN_REVIEW with Ticket #1
    const initialResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(initialResult.isBusinessException).toBe(true);
    expect(initialResult.status).toBe("HUMAN_REVIEW");

    const poAfterHalt = await PurchaseOrderRepository.findById(tenantId, poId);
    expect(poAfterHalt?.status).toBe("HUMAN_REVIEW");

    const reviewsBeforeApproval = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviewsBeforeApproval.length).toBe(1);
    const reviewTicket = reviewsBeforeApproval[0];
    expect(reviewTicket.status).toBe("PENDING");
    expect(reviewTicket.reason).toContain("Subtotal mismatch");

    // 3. Reviewer approves Ticket #1 via POST /reviews/:id/approve
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${reviewTicket._id.toString()}/approve`)
      .set("Authorization", `Bearer ${reviewerToken}`)
      .send({
        resolutionNotes: "Subtotal math approved and reconciled to line item sum (?3,800.00 base + ?684.00 GST = ?4,484.00 total)"
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    // 4. Resume workflow from checkpoint
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeResult.isBusinessException).toBe(false);
    expect(resumeResult.validationErrors.length).toBe(0);
    expect(resumeResult.invoiceNumber).toBeDefined();

    // 5. Invariant A: Exactly ONE review ticket exists for this PO (no Ticket #2 created)
    const allReviewsAfterResume = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviewsAfterResume.length).toBe(1);
    expect(allReviewsAfterResume[0].status).toBe("APPROVED");

    // 6. Invariant B: PO status reaches COMPLETED
    const finalPo = await PurchaseOrderRepository.findById(tenantId, poId);
    expect(finalPo?.status).toBe("COMPLETED");

    // 7. Invariant C: Generated invoice uses CORRECTED subtotal 3800 + tax 684 = 4484 total
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).not.toBeNull();
    expect(invoice?.status).toBe("ISSUED");
    expect(invoice?.subtotal).toBe(3800);
    expect(invoice?.tax).toBe(684);
    expect(invoice?.totalAmount).toBe(4484);

    // 8. Invariant D: Subsequent executions are completely idempotent
    const idempotentResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(idempotentResult.status).toBe("COMPLETED");
    expect(idempotentResult.isBusinessException).toBe(false);

    const reviewsFinalCheck = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviewsFinalCheck.length).toBe(1);
  });
});
