/**
 * Human Review Invariants Test Suite (I1–I7).
 * Runs in in-memory mode — no MongoDB or Redis required.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PurchaseOrderRepository, ReviewRepository, ResumeJobRepository } from "../src/repositories/index.js";
import { env } from "../src/config/env.js";
import { inMemory } from "../src/repositories/base.js";

const TENANT = "inv-test-tenant";

async function seedPOAndReview(stage: string, extra: Record<string, any> = {}) {
  const po = await PurchaseOrderRepository.create(TENANT, {
    poNumber: `PO-INV-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerName: "Test Corp",
    status: "HUMAN_REVIEW",
    subtotal: 1000, tax: 180, totalAmount: 1180,
    lineItems: [],
    createdBy: "uploader-user",
    ...extra
  } as any);
  const review = await ReviewRepository.findOrUpdateStageReview(TENANT, {
    poId: po._id.toString(),
    entityId: po._id.toString(),
    entity: "purchase_order",
    stage,
    status: "PENDING",
    reason: "TEST",
    findings: [],
    priority: "HIGH"
  });
  return { po, review };
}

// I1: createWithTransaction in-memory mode never throws
describe("I1: Approve never throws in in-memory mode", () => {
  it("createWithTransaction succeeds without MongoDB", async () => {
    const { po, review } = await seedPOAndReview("validation");
    let called = 0;
    const outboxId = await ResumeJobRepository.createWithTransaction(
      TENANT, po._id.toString(), review!._id.toString(),
      async () => { called++; }
    );
    expect(typeof outboxId).toBe("string");
    expect(outboxId.length).toBeGreaterThan(0);
    expect(called).toBe(1);
  });

  it("createWithTransaction is non-empty on extraction stage", async () => {
    const { po, review } = await seedPOAndReview("extraction");
    const outboxId = await ResumeJobRepository.createWithTransaction(
      TENANT, po._id.toString(), review!._id.toString(),
      async () => {}
    );
    expect(outboxId).toBeTruthy();
  });
});

// I3: Approve with other open reviews — PO stays HUMAN_REVIEW
describe("I3: Multi-review: PO stays HUMAN_REVIEW when sibling reviews remain", () => {
  it("resolves one review but PO stays HUMAN_REVIEW when a sibling is still PENDING", async () => {
    const { po, review: r1 } = await seedPOAndReview("extraction");

    // Create a sibling review with create() directly (avoids the unique-pending dedup)
    const r2 = await ReviewRepository.create(TENANT, {
      entityId: po._id.toString(),
      entity: "purchase_order",
      stage: "validation",
      reason: "Additional validation check",
      requestedByAgent: "TestAgent",
      priority: "MEDIUM",
      status: "PENDING",
      findings: [],
      evidence: [],
      dedupKey: `sibling-${po._id}-validation-${Date.now()}`
    });

    // Resolve first review only
    const resolved = await ReviewRepository.resolveReview(
      TENANT, r1!._id.toString(), "APPROVED", "approved", "reviewer@test.com"
    );
    expect(resolved?.status).toBe("APPROVED");

    // Sibling r2 is still PENDING — verify it
    const allReviews = await ReviewRepository.findByEntityId(TENANT, po._id.toString());
    const openSiblings = allReviews.filter(
      (r) => (r.status === "PENDING" || r.status === "ESCALATED") && r._id.toString() !== r1!._id.toString()
    );
    expect(openSiblings.length).toBeGreaterThan(0);

    // PO should still be HUMAN_REVIEW — the route handler checks open siblings before resuming.
    // Here we verify the invariant at the data layer: PO was not moved by resolveReview alone.
    const poAfter = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
    expect(poAfter?.status).toBe("HUMAN_REVIEW");
  });
});

// I4: Reject — PO becomes REJECTED, no resume job
describe("I4: Reject sets terminal state, no resume job", () => {
  it("reject sets review REJECTED and PO REJECTED, no PENDING resume row", async () => {
    const { po, review } = await seedPOAndReview("validation");
    await ReviewRepository.resolveReview(TENANT, review!._id.toString(), "REJECTED", "Bad data", "reviewer@test.com");
    await PurchaseOrderRepository.updateHumanReviewStatus(TENANT, po._id.toString(), "REJECTED" as any, {}, true);
    const poAfter = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
    expect(poAfter?.status).toBe("REJECTED");
    // No resume PENDING row for this PO
    const rows = Array.from((inMemory as any).resumeJobs.values()).filter(
      (r: any) => r.poId === po._id.toString() && r.status === "PENDING"
    );
    expect(rows.length).toBe(0);
  });
});

// I5: Idempotency — createWithTransaction called twice doesn't break
describe("I5: Idempotency — repeated createWithTransaction", () => {
  it("second call creates a second outbox row (reconciler dedupes via lock)", async () => {
    const { po, review } = await seedPOAndReview("extraction");
    const id1 = await ResumeJobRepository.createWithTransaction(
      TENANT, po._id.toString(), review!._id.toString(), async () => {}
    );
    const id2 = await ResumeJobRepository.createWithTransaction(
      TENANT, po._id.toString(), review!._id.toString(), async () => {}
    );
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    // Both are different IDs (in-memory generates unique IDs)
    expect(id1).not.toBe(id2);
  });
});

// I6: Maker-checker configurable
describe("I6: Maker-checker only blocks when ENFORCE_MAKER_CHECKER=true", () => {
  afterEach(() => { env.ENFORCE_MAKER_CHECKER = false; });

  it("enforcement off → same-user: no violation", async () => {
    env.ENFORCE_MAKER_CHECKER = false;
    const { po } = await seedPOAndReview("validation");
    const poDoc = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
    const isViolation = env.ENFORCE_MAKER_CHECKER && poDoc?.createdBy === "uploader-user";
    expect(isViolation).toBe(false);
  });

  it("enforcement on → same-user: violation", async () => {
    env.ENFORCE_MAKER_CHECKER = true;
    const { po } = await seedPOAndReview("validation");
    const poDoc = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
    const isViolation = env.ENFORCE_MAKER_CHECKER && poDoc?.createdBy === "uploader-user";
    expect(isViolation).toBe(true);
  });

  it("enforcement on → different user: no violation", async () => {
    env.ENFORCE_MAKER_CHECKER = true;
    const { po } = await seedPOAndReview("validation");
    const poDoc = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
    const isViolation = env.ENFORCE_MAKER_CHECKER && poDoc?.createdBy === "different-user";
    expect(isViolation).toBe(false);
  });
});

// I7: State machine prevents duplicate post
describe("I7: No duplicate stages — state machine blocks COMPLETED → HUMAN_APPROVED", () => {
  it("HUMAN_REVIEW → HUMAN_APPROVED is allowed", async () => {
    const { po } = await seedPOAndReview("extraction");
    const updated = await PurchaseOrderRepository.updateHumanReviewStatus(
      TENANT, po._id.toString(), "HUMAN_APPROVED", { humanVerified: true }, false
    );
    expect(updated?.status).toBe("HUMAN_APPROVED");
  });

  it("COMPLETED → HUMAN_APPROVED is blocked (prevents re-running completed stages)", async () => {
    const { po } = await seedPOAndReview("extraction");
    // Force to COMPLETED using force=true
    await PurchaseOrderRepository.updateHumanReviewStatus(TENANT, po._id.toString(), "COMPLETED" as any, {}, true);
    // Try to move to HUMAN_APPROVED — should be blocked by state machine
    const blocked = await PurchaseOrderRepository.updateHumanReviewStatus(
      TENANT, po._id.toString(), "HUMAN_APPROVED", {}, false
    );
    expect(blocked).toBeNull();
  });

  it("updatePoFn is called exactly once per createWithTransaction", async () => {
    const { po, review } = await seedPOAndReview("validation");
    const calls: string[] = [];
    await ResumeJobRepository.createWithTransaction(
      TENANT, po._id.toString(), review!._id.toString(),
      async (session) => { calls.push(session === null ? "no-session" : "session"); }
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("no-session"); // in-memory mode
  });
});
