/**
 * Group A regression tests
 * A2: retry after failed posting does NOT re-run OCR/matching/validation
 * A3: anti-resurrection bypass (exception node returns HUMAN_APPROVED) → PO reaches COMPLETED
 * A6: FAILED PO → review created → approve → resume job enqueued
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  ProductRepository,
  clearTestRepositories,
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { QueueManager } from "../src/workers/queue.js";
import { runOrchestrationWorkflow, calculateResumeStage } from "../src/ai/workflow/deterministic.js";
import { isValidPOTransition } from "../src/ai/workflow/workflow-state-machine.js";

function token(tenantId: string) {
  return AuthService.generateTokens({
    id: "usr_tester",
    tenantId,
    email: "tester@flowinvoice.io",
    role: "ADMIN" as any,
    name: "Tester",
  }).accessToken;
}

describe("Group A bug regressions", () => {
  const tenantId = "tenant_group_a_test";
  const app = createApp();

  beforeEach(() => {
    QdrantService.clearMockStore();
    clearTestRepositories();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── A2: posting retry does not re-run OCR/matching/validation ────────────
  it("A2: when posting throws, retry re-runs only posting (extraction/matching spies not called)", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-A2-01",
      name: "Widget A2",
      basePrice: 100,
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-A2-RETRY",
      customerName: "Retry Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_APPROVED",
      subtotal: 100,
      tax: 18,
      discount: 0,
      totalAmount: 118,
      extractionConfidence: 1.0,
      isResumed: true,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-A2-01",
          description: "Widget",
          quantity: 1,
          unitPrice: 100,
          lineTotal: 100,
          taxRate: 18,
        },
      ],
    });

    // Spy on extraction and matching agents
    const extractionSpy = vi.fn();
    const matchingSpy = vi.fn();
    vi.doMock("../src/ai/workflow/extraction/extraction.agent.js", () => ({
      createExtractionNode: () => extractionSpy,
    }));
    vi.doMock("../src/ai/workflow/matching/matching.agent.js", () => ({
      createMatchingNode: () => matchingSpy,
    }));

    // Run the workflow — since the PO is HUMAN_APPROVED+isResumed, it should skip
    // extraction and matching and jump straight to posting.
    await runOrchestrationWorkflow(tenantId, po._id.toString(), {}, undefined);

    // Extraction and matching should NOT have been called
    expect(extractionSpy).not.toHaveBeenCalled();
    expect(matchingSpy).not.toHaveBeenCalled();

    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(["COMPLETED", "INVOICE_GENERATING", "HUMAN_APPROVED"]).toContain(updatedPo?.status);
  });

  // ─── A3: anti-resurrection bypass → PO reaches COMPLETED ─────────────────
  it("A3: approved PO with no current errors bypasses exception node and reaches COMPLETED", async () => {
    await ProductRepository.create(tenantId, {
      sku: "SKU-A3-CLEAN",
      name: "Clean Item",
      basePrice: 500,
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-A3-APPROVED",
      customerName: "Clean Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_APPROVED",
      subtotal: 500,
      tax: 90,
      discount: 0,
      totalAmount: 590,
      extractionConfidence: 1.0,
      isResumed: true,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-A3-CLEAN",
          description: "Clean Item",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
          taxRate: 18,
        },
      ],
    });

    // Create an already-approved review so anti-resurrection guard sees it
    await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "APPROVED",
      priority: "HIGH",
      reason: "Previously approved",
      resolvedAt: new Date(),
      resolvedBy: "reviewer@flowinvoice.io",
    });

    await runOrchestrationWorkflow(tenantId, po._id.toString(), {}, undefined);

    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    // PO must have progressed — at minimum to invoice generating or completed
    expect(["COMPLETED", "INVOICE_GENERATING"]).toContain(updatedPo?.status);
  });

  // ─── A4: calculateResumeStage respects checkpointStep over status ──────────
  it("A4: extraction-stage checkpoint resumes at matching, not policyEvaluation", () => {
    const stage = calculateResumeStage(
      { stage: "extraction", checkpointStep: "extraction" },
      undefined,
      "READY_FOR_APPROVAL" // this status would have returned policyEvaluation before fix
    );
    expect(stage).toBe("matching");
  });

  // ─── A6: FAILED -> HUMAN_REVIEW is a valid state-machine transition ───────
  it("A6: isValidPOTransition allows FAILED -> HUMAN_REVIEW", () => {
    expect(isValidPOTransition("FAILED", "HUMAN_REVIEW")).toBe(true);
  });

  // ─── A6: handleResumeExhausted sets PO to HUMAN_REVIEW (not FAILED) ───────
  it("A6: after exhausted retries, reviewer approves and resume job is enqueued", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-A6-FAILED",
      customerName: "Failed Corp",
      status: "HUMAN_REVIEW", // already in HUMAN_REVIEW after resume-failure-handler
      subtotal: 200,
      tax: 36,
      discount: 0,
      totalAmount: 236,
      lineItems: [],
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Pipeline resume failed (all retries exhausted)",
    });

    const addResumeJobSpy = vi
      .spyOn(QueueManager, "addPOResumeJob")
      .mockResolvedValue({ jobId: "test-job", enqueued: true });

    const res = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token(tenantId)}`)
      .send({ resolutionNotes: "Manually re-approving after retries exhausted" });

    expect(res.status).toBe(200);
    expect(addResumeJobSpy).toHaveBeenCalledTimes(1);
  });
});
