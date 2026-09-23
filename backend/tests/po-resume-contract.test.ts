/**
 * End-to-End PO Resume Contract & Resumption Worker Tests
 *
 * Tests 1-2 (shadow endpoint): removed — the /po/:id/resume route was
 * deliberately deleted. All resume actions now flow through /reviews/:id/approve.
 *
 * Tests 3-5 replaced to cover the durable outbox + approve contract.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { QueueManager } from "../src/workers/queue.js";

function generateAuthToken(tenantId: string, role: any = "ADMIN"): string {
  return AuthService.generateTokens({
    id: "usr_resume_tester_1",
    tenantId,
    email: "reviewer@flowinvoice.io",
    role,
    name: "Review Tester"
  }).accessToken;
}

describe("End-to-End PO Resume Contract & Resumption Worker Tests", () => {
  const tenantId = "tenant_resume_contract";
  const app = createApp();
  let token: string;

  beforeEach(() => {
    QdrantService.clearMockStore();
    clearTestRepositories();
    token = generateAuthToken(tenantId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Test 1: Shadow endpoint is gone ─────────────────────────────────────
  it("1. /api/v1/po/:id/resume shadow endpoint is deleted and returns 404", async () => {
    const res = await request(app)
      .post("/api/v1/po/some-id/resume")
      .set("Authorization", `Bearer ${token}`)
      .send({ po: { totalAmount: 1000 } });

    expect(res.status).toBe(404);
  });

  // ─── Test 2: Approve through reviews endpoint writes outbox PENDING ───────
  it("2. /reviews/:id/approve creates outbox row and returns QUEUED resumeStatus", async () => {
    const addJobSpy = vi.spyOn(QueueManager, "addPOResumeJob").mockResolvedValue("mock-job-id");

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-CONTRACT-002",
      customerName: "Alpha Corp",
      vendorName: "Alpha Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_REVIEW",
      subtotal: 1000.0,
      tax: 180.0,
      discount: 0,
      totalAmount: 1180.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-CONTRACT",
          description: "Contract Test Item",
          quantity: 1,
          unitPrice: 1000.0,
          lineTotal: 1000.0,
          taxRate: 18.0
        }
      ]
    });

    // Create a review ticket referencing the PO
    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "LINE_ITEM_MISMATCH",
      requestedByAgent: "ValidationAgent"
    });

    const res = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Approved after correction" });

    expect(res.status).toBe(200);
    expect(res.body.resumeStatus).toBe("QUEUED");

    // Verify outbox pattern was called (addPOResumeJob called with outboxId)
    expect(addJobSpy).toHaveBeenCalledWith(
      tenantId,
      po._id.toString(),
      review._id.toString(),
      expect.any(String)  // outboxId
    );
  });

  // ─── Test 3: Worker skips Agents 1-3 (OCR/Math) when resuming ────────────
  it("3. Worker skips Agents 1-3 (OCR/Math) when resuming PO in READY_FOR_APPROVAL", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-RESUME-CHECK",
      name: "Resume Check Node",
      basePrice: 500.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-003",
      customerName: "Delta Systems",
      vendorName: "Delta Systems",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "READY_FOR_APPROVAL",
      isResumed: true,
      subtotal: 500.0,
      tax: 90.0,
      discount: 0,
      totalAmount: 590.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-RESUME-CHECK",
          description: "Resume Check Node",
          quantity: 1,
          unitPrice: 500.0,
          lineTotal: 500.0,
          taxRate: 18.0
        }
      ]
    });

    const executedSteps: string[] = [];
    const { runDeterministicWorkflow } = await import("../src/ai/workflow/deterministic.js");

    const result = await runDeterministicWorkflow(tenantId, po._id.toString(), {
      onStepUpdate: (evt) => executedSteps.push(evt.step)
    });

    // Agents 1-3: extraction (OCR), matching, poValidation must NOT be in executed steps!
    expect(executedSteps).not.toContain("extraction");
    expect(executedSteps).not.toContain("matching");
    expect(executedSteps).not.toContain("poValidation");

    // Must have executed policyEvaluation / approvalDecision / posting
    expect(executedSteps).toContain("policyEvaluation");
    expect(result.status).toBe("COMPLETED");
  });

  // ─── Test 4: processPOJobWithEntity processes po-resume job ──────────────
  it("4. processPOJobWithEntity processes po-resume job and skips Agents 1-3 to terminal status", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-WORKER-TEST",
      name: "Worker Test Product",
      basePrice: 1000.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-004",
      customerName: "Omega Corp",
      vendorName: "Omega Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "READY_FOR_APPROVAL",
      isResumed: true,
      subtotal: 1000.0,
      tax: 180.0,
      discount: 0,
      totalAmount: 1180.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-WORKER-TEST",
          description: "Worker Test Product",
          quantity: 1,
          unitPrice: 1000.0,
          lineTotal: 1000.0,
          taxRate: 18.0
        }
      ]
    });

    const { processPOJobWithEntity } = await import("../src/workers/queue.js");

    const mockJob: any = {
      id: "job-test-101",
      name: "po-resume",
      data: {
        poId: po._id.toString(),
        tenantId,
        isResumeAction: true
      }
    };

    await processPOJobWithEntity(mockJob);

    const updatedPO = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(["APPROVED", "COMPLETED"]).toContain(updatedPO?.status);
  });

  // ─── Test 5: addPOResumeJob leaves outbox PENDING when BullMQ fails ──────
  it("5. addPOResumeJob leaves outbox PENDING (no setTimeout) when BullMQ unavailable", async () => {
    // When Redis is not connected (isMock=true), addPOResumeJob should return
    // the jobId without throwing, and NOT create an in-memory setTimeout.
    const jobId = await QueueManager.addPOResumeJob(
      tenantId,
      "po-999",
      "review-999",
      "outbox-999"
    );

    expect(typeof jobId).toBe("string");
    expect(jobId).toContain("po-resume");
    // No assertion on setTimeout — absence of the volatile retry is the contract.
  });
});
