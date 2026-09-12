import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  ProductRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

/**
 * Regression coverage for:
 *   "CRITICAL: HUMAN REVIEW QUEUE BEHAVIOR"
 *
 * The active Human Review queue (GET /reviews, default status filter used by the
 * frontend = PENDING) must contain ONLY POs that still require a human decision.
 * Approving or rejecting a PO must:
 *   1. Persist the final status on the PO.
 *   2. Mark the review task RESOLVED (APPROVED/REJECTED) -- not left PENDING.
 *   3. Cause the PO to disappear from the active (status=PENDING) queue.
 *   4. Survive a "refresh" (re-querying the same endpoint) without reappearing,
 *      even once any asynchronous post-approval workflow has finished running.
 */
function generateAuthToken(tenantId: string): string {
  return AuthService.generateTokens({
    id: "usr_reviewer_hrq",
    tenantId,
    email: "reviewer@enterprise.com",
    role: "REVIEWER",
    name: "Reviewer User"
  }).accessToken;
}

async function fetchActiveQueue(app: any, token: string) {
  const res = await request(app)
    .get("/api/v1/reviews?status=PENDING&pageSize=50")
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data as Array<{ id: string; entityId: string; status: string }>;
}

describe("Human Review Queue Removal on Approve/Reject", () => {
  const tenantId = "test_tenant_hrq";
  const app = createApp();
  let token: string;

  beforeEach(() => {
    QdrantService.clearMockStore();
    clearTestRepositories();
    resetWorkflowRateLimiter();
    token = generateAuthToken(tenantId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes an approved PO from the active queue, persists APPROVED, and it never reappears after refresh or async workflow completion", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-QUEUE-01",
      name: "Queue Test Widget",
      basePrice: 100.0
    });

    const poA = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-QUEUE-A",
      customerName: "Queue Test Corp",
      gstNumber: "27AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      subtotal: 200.0,
      tax: 36.0,
      discount: 0,
      totalAmount: 236.0,
      extractionConfidence: 0.6,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-QUEUE-01",
          description: "Queue Test Widget",
          quantity: 2,
          unitPrice: 100.0,
          lineTotal: 200.0,
          taxRate: 18.0
        }
      ]
    });

    // A second, unrelated PO that must remain in the queue throughout.
    const poB = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-QUEUE-B",
      customerName: "Queue Test Corp",
      gstNumber: "27AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      subtotal: 100.0,
      tax: 18.0,
      discount: 0,
      totalAmount: 118.0,
      extractionConfidence: 0.6,
      lineItems: []
    });

    const reviewA = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poA._id.toString(),
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "Low extraction confidence",
      requestedByAgent: "ExtractionAgent"
    });

    const reviewB = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poB._id.toString(),
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "Low extraction confidence",
      requestedByAgent: "ExtractionAgent"
    });

    // Before: both POs show up in the active queue.
    const before = await fetchActiveQueue(app, token);
    expect(before.some((r) => r.entityId === poA._id.toString())).toBe(true);
    expect(before.some((r) => r.entityId === poB._id.toString())).toBe(true);

    // Approve PO-QUEUE-A.
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${reviewA._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        resolutionNotes: "Verified against source document",
        correctedLineItems: [
          {
            lineNumber: 1,
            productCode: "SKU-QUEUE-01",
            description: "Queue Test Widget",
            quantity: 2,
            unitPrice: 100.0,
            lineTotal: 200.0,
            taxRate: 18.0
          }
        ]
      });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    // Immediately after: PO-QUEUE-A must already be gone from the active queue,
    // while PO-QUEUE-B remains untouched.
    const afterApprove = await fetchActiveQueue(app, token);
    expect(afterApprove.some((r) => r.entityId === poA._id.toString())).toBe(false);
    expect(afterApprove.some((r) => r.entityId === poB._id.toString())).toBe(true);

    // Let the asynchronous post-approval workflow (setImmediate -> orchestration graph) finish.
    for (let i = 0; i < 30; i++) {
      const checkPo = await PurchaseOrderRepository.findById(tenantId, poA._id.toString());
      if (checkPo && checkPo.status !== "HUMAN_REVIEW" && checkPo.status !== "PROCESSING") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Review task itself must be resolved, never left/reset to PENDING.
    const storedReviewA = await ReviewRepository.findById(tenantId, reviewA._id.toString());
    expect(storedReviewA!.status).toBe("APPROVED");

    // The PO must not have a *new* PENDING review created for it by the async workflow.
    const allReviewsForA = await request(app)
      .get(`/api/v1/reviews?stage=extraction&pageSize=50`)
      .set("Authorization", `Bearer ${token}`);
    const staleForA = allReviewsForA.body.data.filter(
      (r: any) => r.entityId === poA._id.toString() && r.status === "PENDING"
    );
    expect(staleForA.length).toBe(0);

    // "Refresh" the queue again (simulates browser refresh / navigate away and back).
    const afterRefresh = await fetchActiveQueue(app, token);
    expect(afterRefresh.some((r) => r.entityId === poA._id.toString())).toBe(false);
    expect(afterRefresh.some((r) => r.entityId === poB._id.toString())).toBe(true);

    // PO's own record must reflect a resolved (non HUMAN_REVIEW) status on "browser refresh".
    const finalPo = await PurchaseOrderRepository.findById(tenantId, poA._id.toString());
    expect(finalPo!.status).not.toBe("HUMAN_REVIEW");
    expect(finalPo!.status).not.toBe("PENDING_HUMAN_REVIEW");
  });

  it("removes a rejected PO from the active queue, persists REJECTED, and it never reappears after refresh", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-QUEUE-02",
      name: "Reject Test Widget",
      basePrice: 100.0
    });

    // Price deviates well beyond tolerance so reanalysis still finds a discrepancy on reject.
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-QUEUE-C",
      customerName: "Queue Test Corp",
      gstNumber: "27AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      subtotal: 300.0,
      tax: 54.0,
      discount: 0,
      totalAmount: 354.0,
      extractionConfidence: 0.95,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-QUEUE-02",
          description: "Reject Test Widget",
          quantity: 1,
          unitPrice: 300.0,
          lineTotal: 300.0,
          taxRate: 18.0
        }
      ]
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Price deviates from catalog",
      requestedByAgent: "ValidationAgent"
    });

    const before = await fetchActiveQueue(app, token);
    expect(before.some((r) => r.entityId === po._id.toString())).toBe(true);

    const rejectRes = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Price not authorized" });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("REJECTED");

    const afterReject = await fetchActiveQueue(app, token);
    expect(afterReject.some((r) => r.entityId === po._id.toString())).toBe(false);

    const storedReview = await ReviewRepository.findById(tenantId, review._id.toString());
    expect(storedReview!.status).toBe("REJECTED");

    const storedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(storedPo!.status).toBe("REJECTED");

    // Simulate browser refresh: the queue must still not contain it.
    const afterRefresh = await fetchActiveQueue(app, token);
    expect(afterRefresh.some((r) => r.entityId === po._id.toString())).toBe(false);
  });

  it("closes duplicate PENDING tickets for the same PO with the SAME decision as the primary review (no APPROVED/REJECTED mismatch)", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-QUEUE-03",
      name: "Duplicate Ticket Widget",
      basePrice: 50.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-QUEUE-DUP",
      customerName: "Queue Test Corp",
      gstNumber: "27AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      subtotal: 500.0,
      tax: 90.0,
      discount: 0,
      totalAmount: 590.0,
      extractionConfidence: 0.95,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-QUEUE-03",
          description: "Duplicate Ticket Widget",
          quantity: 1,
          unitPrice: 500.0,
          lineTotal: 500.0,
          taxRate: 18.0
        }
      ]
    });

    // Two PENDING tickets raised against the same PO (e.g. two independent agent flags).
    const primaryReview = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Price deviates from catalog",
      requestedByAgent: "ValidationAgent"
    });

    const duplicateReview = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Duplicate flag for the same PO",
      requestedByAgent: "ValidationAgent"
    });

    const rejectRes = await request(app)
      .post(`/api/v1/reviews/${primaryReview._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Price not authorized" });

    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.status).toBe("REJECTED");

    // The duplicate ticket must be closed as REJECTED too, not silently flipped to APPROVED.
    const storedDuplicate = await ReviewRepository.findById(tenantId, duplicateReview._id.toString());
    expect(storedDuplicate!.status).toBe("REJECTED");

    // And, either way, it must be gone from the active queue.
    const afterReject = await fetchActiveQueue(app, token);
    expect(afterReject.some((r) => r.id === duplicateReview._id.toString())).toBe(false);
  });

  it("reopens a CRITICAL review ticket and sets PO to FAILED when workflow resume throws upon approval", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-FAIL-TEST",
      customerName: "Resume Fail Corp",
      gstNumber: "27AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      subtotal: 500.0,
      tax: 90.0,
      totalAmount: 590.0,
      extractionConfidence: 0.6,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-FAIL-01",
          description: "Resume Fail Item",
          quantity: 5,
          unitPrice: 100.0,
          lineTotal: 500.0,
          taxRate: 18.0
        }
      ]
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Simulated validation review requiring resume",
      requestedByAgent: "ValidationAgent"
    });

    const workflowModule = await import("../src/ai/workflow/index.js");
    vi.spyOn(workflowModule, "runOrchestrationWorkflow").mockRejectedValueOnce(
      new Error("Simulated posting ERP gateway connection timed out")
    );

    const approveRes = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Approved despite variance" });

    // 1. Approve endpoint still returns 200 with resumeStatus: "FAILED"
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");
    expect(approveRes.body.resumeStatus).toBe("FAILED");
    expect(approveRes.body.poStatus).toBe("FAILED");

    // 2. The PO status must be FAILED
    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPo?.status).toBe("FAILED");

    // 3. A new review ticket exists with status PENDING and priority CRITICAL
    const allReviews = await ReviewRepository.findByEntityId(tenantId, po._id.toString());
    const reopenedReview = allReviews.find((r) => r.status === "PENDING" && r.priority === "CRITICAL");
    expect(reopenedReview).toBeDefined();
    expect(reopenedReview?.reason).toContain("Pipeline resume failed after approval: Simulated posting ERP gateway connection timed out");
    expect(reopenedReview?.requestedByAgent).toBe("SupervisorAgent");
  });
});
