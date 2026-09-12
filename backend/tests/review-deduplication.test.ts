import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  ProductRepository,
  clearTestRepositories,
  computeReviewDedupKey
} from "../src/repositories/index.js";
import { runMigration } from "../src/scripts/collapse-duplicate-reviews.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

function generateAuthToken(tenantId: string): string {
  return AuthService.generateTokens({
    id: "usr_reviewer_dedup",
    tenantId,
    email: "reviewer@enterprise.com",
    role: "REVIEWER",
    name: "Reviewer User"
  }).accessToken;
}

describe("Review Queue Deduplication, Write-Time Upsert & Approval Propagation", () => {
  const tenantId = "tenant_review_dedup_test";
  const app = createApp();
  let token: string;

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
    token = generateAuthToken(tenantId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) re-submitting the same validation event twice results in only one queue item", async () => {
    const poId = "6aa40ad7f27b8b18e580fe83";
    const payload = {
      entity: "purchase_order" as const,
      entityId: poId,
      stage: "extraction" as const,
      status: "PENDING" as const,
      priority: "CRITICAL" as const,
      reason: "Line 1 math mismatch: 18 * 98500 != 1974690",
      requestedByAgent: "FlowInvoice_po_validation",
      expectedValue: "Within Contract/Policy Limits",
      actualValue: "Line 1 math mismatch: 18 * 98500 != 1974690",
      evidence: [
        {
          sourceType: "POLICY" as const,
          documentId: "doc_policy_1",
          documentName: "Procurement Policy",
          pageNumber: 1,
          section: "Math Reconciliation",
          chunkId: "chunk_math_1",
          claim: "Line item total must equal quantity * unitPrice"
        }
      ]
    };

    // First emission
    const rev1 = await ReviewRepository.create(tenantId, payload);
    expect(rev1).toBeDefined();
    expect(rev1.dedupKey).toBeDefined();

    // Re-submission 1 (e.g. retry / webhook replay / re-validation)
    const rev2 = await ReviewRepository.create(tenantId, {
      ...payload,
      evidence: [
        {
          sourceType: "CONTRACT" as const,
          documentId: "doc_contract_2",
          documentName: "Master Service Agreement",
          pageNumber: 3,
          section: "Pricing",
          chunkId: "chunk_price_2",
          claim: "Standard tier discount clause"
        }
      ]
    });

    // Must update the existing ticket and return the same ID
    expect(rev2._id.toString()).toBe(rev1._id.toString());

    // Re-submission 2
    const rev3 = await ReviewRepository.create(tenantId, payload);
    expect(rev3._id.toString()).toBe(rev1._id.toString());

    // Query active queue via API
    const listRes = await request(app)
      .get("/api/v1/reviews?status=PENDING")
      .set("Authorization", `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0].id).toBe(rev1._id.toString());
    // Evidence must be merged cleanly
    expect(listRes.body.data[0].evidenceCount).toBe(2);
  });

  it("(b) approving one of several duplicate rows causes all sibling duplicates to be marked APPROVED rather than staying PENDING", async () => {
    const poId = "6aa40ac8f27b8b18e580fe56";
    const dedupKey = computeReviewDedupKey(tenantId, {
      entityId: poId,
      entity: "purchase_order",
      stage: "extraction",
      requestedByAgent: "FlowInvoice_po_validation",
      reason: "Duplicate PO number: 20031234-1"
    });

    // Simulate pre-existing legacy duplicate rows sharing the same dedup key or entity
    const reviewPrimary = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Duplicate PO number: 20031234-1",
      requestedByAgent: "FlowInvoice_po_validation",
      dedupKey
    });

    // Force insert a secondary duplicate row to simulate historical data
    const reviewSibling = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Duplicate PO number: 20031234-1 (duplicate flag)",
      requestedByAgent: "FlowInvoice_po_validation"
    });

    // Check both are initially PENDING
    const initialPending = await request(app)
      .get("/api/v1/reviews?status=PENDING")
      .set("Authorization", `Bearer ${token}`);
    expect(initialPending.body.data.length).toBe(2);

    // Approve the primary review item
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${reviewPrimary._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Approved duplicate PO override" });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    // Sibling duplicate MUST automatically be marked APPROVED via propagation rule
    const storedSibling = await ReviewRepository.findById(tenantId, reviewSibling._id.toString());
    expect(storedSibling).toBeDefined();
    expect(storedSibling!.status).toBe("APPROVED");
    expect(storedSibling!.resolutionNotes).toContain("Resolved alongside primary review approval");

    // Active pending queue must now be completely empty
    const queueAfterApproval = await request(app)
      .get("/api/v1/reviews?status=PENDING")
      .set("Authorization", `Bearer ${token}`);

    expect(queueAfterApproval.body.data.length).toBe(0);
  });

  it("(c) re-submitting an exception for an already APPROVED item preserves APPROVED status and does not create a new PENDING ticket", async () => {
    const poId = "6aa40aa8f27b8b18e580fe1e";
    const payload = {
      entity: "purchase_order" as const,
      entityId: poId,
      stage: "extraction" as const,
      status: "PENDING" as const,
      priority: "CRITICAL" as const,
      reason: "Line 1 math mismatch: 18 * 98500 != 1974690",
      requestedByAgent: "FlowInvoice_po_validation"
    };

    // 1. Initial creation
    const review = await ReviewRepository.create(tenantId, payload);
    expect(review.status).toBe("PENDING");

    // 2. Human reviewer approves the ticket
    await ReviewRepository.resolveReview(
      tenantId,
      review._id.toString(),
      "APPROVED",
      "Human verified math override",
      "reviewer@enterprise.com"
    );

    const approvedReview = await ReviewRepository.findById(tenantId, review._id.toString());
    expect(approvedReview!.status).toBe("APPROVED");

    // 3. Upstream workflow re-triggers or retries validation with the same payload
    const retriggerReview = await ReviewRepository.create(tenantId, payload);

    // Must return the existing record and preserve APPROVED status
    expect(retriggerReview._id.toString()).toBe(review._id.toString());
    expect(retriggerReview.status).toBe("APPROVED");

    // Active pending queue must remain 0
    const queueRes = await request(app)
      .get("/api/v1/reviews?status=PENDING")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.body.data.length).toBe(0);
  });

  it("(d) migration script collapses duplicate rows into one canonical row per dedup key with APPROVED precedence", async () => {
    const poId = "6aa40aa8f27b8b18e580fe99";
    const dedupKey = "canonical_dedup_key_test_123";

    // Simulate 3 legacy duplicate records in the queue before migration (1 APPROVED, 2 PENDING)
    const id1 = "6aa40aa8f27b8b18e580f001";
    const id2 = "6aa40aa8f27b8b18e580f002";
    const id3 = "6aa40aa8f27b8b18e580f003";

    (ReviewRepository as any);
    const { inMemory } = await import("../src/repositories/base.js");

    inMemory.reviews.set(id1, {
      _id: id1,
      id: id1,
      tenantId,
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "PENDING",
      reason: "Repeated line error",
      requestedByAgent: "FlowInvoice_po_validation",
      dedupKey,
      evidence: [{ sourceType: "POLICY", documentId: "d1", documentName: "P1", pageNumber: 1, section: "S1", claim: "C1" }],
      createdAt: new Date("2026-09-01"),
      updatedAt: new Date("2026-09-01")
    });

    inMemory.reviews.set(id2, {
      _id: id2,
      id: id2,
      tenantId,
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "APPROVED",
      reason: "Repeated line error",
      requestedByAgent: "FlowInvoice_po_validation",
      dedupKey,
      evidence: [{ sourceType: "CONTRACT", documentId: "d2", documentName: "C2", pageNumber: 2, section: "S2", claim: "C2" }],
      resolvedAt: new Date("2026-09-02"),
      resolvedBy: "admin@enterprise.com",
      resolutionNotes: "Approved earlier",
      createdAt: new Date("2026-09-02"),
      updatedAt: new Date("2026-09-02")
    });

    inMemory.reviews.set(id3, {
      _id: id3,
      id: id3,
      tenantId,
      entity: "purchase_order",
      entityId: poId,
      stage: "extraction",
      status: "PENDING",
      reason: "Repeated line error",
      requestedByAgent: "FlowInvoice_po_validation",
      dedupKey,
      evidence: [],
      createdAt: new Date("2026-09-03"),
      updatedAt: new Date("2026-09-03")
    });

    // Run duplicate collapsing migration
    const migrationResult = await runMigration(tenantId);
    expect(migrationResult.duplicatesDeleted).toBe(2);
    expect(migrationResult.canonicalUpdated).toBe(1);

    // Verify exactly 1 canonical record remains for this dedupKey and it is APPROVED with merged evidence
    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviews.length).toBe(1);
    expect(allReviews[0].status).toBe("APPROVED");
    expect(allReviews[0].evidence.length).toBe(2);
  });

  it("(e) concurrent write attempts for the same validation event resolve to a single record", async () => {
    const poId = "6aa40aa8f27b8b18e580fe77";
    const payload = {
      entity: "purchase_order" as const,
      entityId: poId,
      stage: "validation" as const,
      status: "PENDING" as const,
      priority: "HIGH" as const,
      reason: "Concurrent price deviation check",
      requestedByAgent: "ValidationAgent"
    };

    // 10 concurrent creates
    const results = await Promise.all(
      Array.from({ length: 10 }, () => ReviewRepository.create(tenantId, payload))
    );

    const firstId = results[0]._id.toString();
    for (const r of results) {
      expect(r._id.toString()).toBe(firstId);
    }

    const items = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(items.length).toBe(1);
  });
});
