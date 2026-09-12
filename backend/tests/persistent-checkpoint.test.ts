import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  InvoiceRepository,
  AuditRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { runOrchestrationWorkflow, buildOrchestrationGraph } from "../src/ai/workflow/graph.js";
import { MongoCheckpointSaver } from "../src/ai/workflow/checkpoint.service.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

function generateAuthToken(tenantId: string, userId: string = "usr_reviewer_1"): string {
  return AuthService.generateTokens({
    id: userId,
    tenantId,
    email: "reviewer@enterprise.com",
    role: "REVIEWER",
    name: "Reviewer User"
  }).accessToken;
}

describe("Fix 1: Persistent Checkpoint Storage Test Suite", () => {
  const tenantId = "tenant_checkpoint_test";
  const app = createApp();

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists checkpoint to storage on pause and resumes seamlessly across fresh checkpointer instances without restarting", async () => {
    const token = generateAuthToken(tenantId, "usr_reviewer_1");

    // 1. Create a PO with a low extraction confidence that triggers human review pause
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-PERSIST-CP-01",
      customerName: "Acme Industrial",
      status: "PROCESSING",
      extractionConfidence: 0.5, // Triggers exception pause
      lineItems: [
        { lineNumber: 1, productCode: "SKU-CP-1", description: "Item 1", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 18 }
      ],
      subtotal: 500,
      tax: 90,
      totalAmount: 590
    });
    const poId = po._id.toString();

    // 2. Initial execution runs to pause point (HUMAN_REVIEW)
    const run1Result = await runOrchestrationWorkflow(tenantId, poId);
    expect(run1Result.status).toBe("HUMAN_REVIEW");
    expect(run1Result.isBusinessException).toBe(true);

    // 3. Verify checkpoint was persisted into MongoCheckpointSaver
    const checkpointer1 = new MongoCheckpointSaver(tenantId);
    const tuple1 = await checkpointer1.getTuple({
      configurable: { thread_id: poId }
    });
    expect(tuple1).toBeDefined();
    expect(tuple1?.checkpoint).toBeDefined();
    expect(tuple1?.config.configurable?.thread_id).toBe(poId);

    // 4. Simulate process restart: instantiate a completely FRESH checkpointer & graph
    const freshCheckpointer = new MongoCheckpointSaver(tenantId);
    const retrievedTuple = await freshCheckpointer.getTuple({
      configurable: { thread_id: poId }
    });
    expect(retrievedTuple).toBeDefined();
    expect(retrievedTuple?.checkpoint).toBeDefined();

    // 5. Independent reviewer approves the review ticket via API
    const openReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(openReviews.length).toBeGreaterThanOrEqual(1);
    const targetReview = openReviews[0];

    const approveRes = await request(app)
      .post(`/api/v1/reviews/${targetReview._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Verified low confidence text manually" });

    expect(approveRes.status).toBe(200);

    // 6. Resume workflow with a FRESH graph instance
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeResult.invoiceId).toBeDefined();
    expect(["posting", "completed"]).toContain(resumeResult.currentStep);

    // 7. Verify an invoice was created and posted
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeDefined();
    expect(invoice?.poId).toBe(poId);
    expect(invoice?.totalAmount).toBe(590);

    // 8. Confirm extraction / matching were bypassed and workflow proceeded directly to posting
    const auditEntries = await AuditRepository.findByEntityId(tenantId, poId);
    const actions = auditEntries.map((a) => a.action);
    expect(actions).toContain("REVIEW_APPROVED");
    expect(actions).not.toContain("MATCH_CONTRACTS");
  });
});
