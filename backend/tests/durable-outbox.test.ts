/**
 * Durable Job Outbox — 4 targeted tests
 *
 * 1. Atomic outbox creation: PO status update + outbox row always written together.
 * 2. Reconciler: picks up a stale PENDING row and re-attempts BullMQ.
 * 3. Dashboard: HUMAN_APPROVED status counted in approvedPOs.
 * 4. Shadow endpoint removed: /api/v1/pos/:id/resume returns 404.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { clearTestRepositories, inMemory } from "../src/repositories/base.js";
import { ResumeJobRepository } from "../src/repositories/index.js";
import { runReconcilerCycle } from "../src/workers/reconciler.js";
import { QueueManager } from "../src/workers/queue.js";
import { createApp } from "../src/app.js";
import request from "supertest";

// ──────────────────────────────────────────────────────────────────────────────
// Setup
// ──────────────────────────────────────────────────────────────────────────────
vi.mock("../src/auth/auth.middleware.js", () => ({
  authenticate: (_req: any, _res: any, next: any) => {
    _req.user = { id: "u1", email: "reviewer@test.com", tenantId: "tenant-test", role: "REVIEWER" };
    next();
  }
}));

vi.mock("../src/workers/queue.js", async () => {
  const actual = await vi.importActual<typeof import("../src/workers/queue.js")>("../src/workers/queue.js");
  return {
    ...actual,
    QueueManager: {
      ...actual.QueueManager,
      addPOResumeJob: vi.fn().mockResolvedValue("mock-job-id"),
      getHealthStatus: vi.fn().mockReturnValue({ status: "connected", mode: "bullmq", provider: "redis", isConfigured: true, connectionType: "url", connectAttempts: 1, lastError: null })
    }
  };
});

beforeEach(() => {
  clearTestRepositories();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 1: Atomic outbox creation
// ──────────────────────────────────────────────────────────────────────────────
describe("1. Atomic outbox creation", () => {
  it("should write outbox row in PENDING state alongside the PO update", async () => {
    let updateWasCalled = false;
    const outboxId = await ResumeJobRepository.createWithTransaction(
      "tenant-test",
      "po-abc",
      "review-xyz",
      async (_session) => {
        // Simulate PO status update
        inMemory.pos.set("po-abc", {
          id: "po-abc",
          tenantId: "tenant-test",
          status: "HUMAN_APPROVED",
          updatedAt: new Date()
        });
        updateWasCalled = true;
      }
    );

    expect(updateWasCalled).toBe(true);
    expect(outboxId).toBeTruthy();

    const row = inMemory.resumeJobs.get(outboxId);
    expect(row).toBeDefined();
    expect(row.status).toBe("PENDING");
    expect(row.poId).toBe("po-abc");
    expect(row.tenantId).toBe("tenant-test");
    expect(row.reviewId).toBe("review-xyz");

    const po = inMemory.pos.get("po-abc");
    expect(po?.status).toBe("HUMAN_APPROVED");
  });

  it("should mark outbox row ENQUEUED after successful BullMQ dispatch", async () => {
    const outboxId = await ResumeJobRepository.createWithTransaction(
      "tenant-test", "po-abc", "review-xyz", async () => {}
    );
    await ResumeJobRepository.markEnqueued(outboxId);

    const row = inMemory.resumeJobs.get(outboxId);
    expect(row?.status).toBe("ENQUEUED");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 2: Reconciler picks up stale PENDING rows
// ──────────────────────────────────────────────────────────────────────────────
describe("2. Reconciler picks up stale PENDING rows", () => {
  it("should re-attempt addPOResumeJob for a stale PENDING outbox row", async () => {
    // Create a PENDING outbox row that appears old
    const staleDate = new Date(Date.now() - 3 * 60 * 1000); // 3 min ago
    const outboxId = "outbox-stale-001";
    inMemory.resumeJobs.set(outboxId, {
      id: outboxId,
      tenantId: "tenant-test",
      poId: "po-stale",
      reviewId: "review-stale",
      status: "PENDING",
      attempts: 0,
      lastError: null,
      processingLock: null,
      createdAt: staleDate,
      updatedAt: staleDate
    });

    // Seed PO in a resumable state
    inMemory.pos.set("po-stale", {
      id: "po-stale",
      tenantId: "tenant-test",
      status: "HUMAN_APPROVED"
    });

    await runReconcilerCycle();

    expect(QueueManager.addPOResumeJob).toHaveBeenCalledWith(
      "tenant-test",
      "po-stale",
      "review-stale",
      outboxId
    );
  });

  it("should mark outbox DONE when PO is already in terminal state", async () => {
    const staleDate = new Date(Date.now() - 3 * 60 * 1000);
    const outboxId = "outbox-terminal-001";
    inMemory.resumeJobs.set(outboxId, {
      id: outboxId,
      tenantId: "tenant-test",
      poId: "po-terminal",
      reviewId: "review-t",
      status: "PENDING",
      attempts: 0,
      lastError: null,
      processingLock: null,
      createdAt: staleDate,
      updatedAt: staleDate
    });

    // PO already completed — should NOT be re-enqueued
    inMemory.pos.set("po-terminal", {
      id: "po-terminal",
      tenantId: "tenant-test",
      status: "COMPLETED"
    });

    await runReconcilerCycle();

    expect(QueueManager.addPOResumeJob).not.toHaveBeenCalled();
    const row = inMemory.resumeJobs.get(outboxId);
    expect(row?.status).toBe("DONE");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 3: Dashboard includes HUMAN_APPROVED in approvedPOs count
// ──────────────────────────────────────────────────────────────────────────────
describe("3. Dashboard approvedPOs includes HUMAN_APPROVED", () => {
  it("should count HUMAN_APPROVED POs in approvedPOs (in-memory path)", async () => {
    const app = createApp();

    // Seed POs with mixed statuses
    inMemory.pos.set("po-1", { id: "po-1", tenantId: "tenant-test", status: "HUMAN_APPROVED", extractionConfidence: 0.95 });
    inMemory.pos.set("po-2", { id: "po-2", tenantId: "tenant-test", status: "COMPLETED", extractionConfidence: 0.97 });
    inMemory.pos.set("po-3", { id: "po-3", tenantId: "tenant-test", status: "PENDING", extractionConfidence: 0.80 });

    const res = await request(app)
      .get("/api/v1/dashboard/summary")
      .set("Authorization", "Bearer mock-token");

    expect(res.status).toBe(200);
    expect(res.body.totalPOs).toBe(3);
    // HUMAN_APPROVED + COMPLETED = 2
    expect(res.body.approvedPOs).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Test 4: Shadow endpoint removed — returns 404
// ──────────────────────────────────────────────────────────────────────────────
describe("4. Shadow endpoint removed", () => {
  it("GET /api/v1/po/any-id/resume should return 404", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/po/some-po-id/resume")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).toBe(404);
  });

  it("POST /api/v1/pos/any-id/resume should return 404", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/pos/some-po-id/resume")
      .set("Authorization", "Bearer mock-token");
    expect(res.status).toBe(404);
  });
});
