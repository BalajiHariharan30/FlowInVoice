import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  clearTestRepositories,
  PurchaseOrderRepository,
  ReviewRepository
} from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

const app = createApp();

describe("PO Soft-Delete & Ghost Duplicate Prevention", () => {
  const tenantId = "tenant_softdelete_test";
  const userToken = AuthService.generateTokens({
    id: "user_sd_test",
    tenantId,
    email: "admin@softdeletetest.com",
    name: "SoftDelete Admin",
    role: "ADMIN"
  }).accessToken;

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows reusing a PO number after soft-deleting the previous PO with that number", async () => {
    const poNumber = "PO-REUSE-999";

    // 1. Create original PO
    const po1 = await PurchaseOrderRepository.create(tenantId, {
      poNumber,
      customerName: "Original Corp",
      gstNumber: "29AABCU9603R1ZM",
      status: "HUMAN_REVIEW",
      s3Key: "pos/po1.pdf",
      documentName: "po1.pdf",
      documentSize: 1024,
      contentType: "application/pdf"
    });

    // Create an open review ticket for this PO
    const review = await ReviewRepository.create(tenantId, {
      poId: po1.id,
      stage: "EXTRACTION",
      status: "PENDING",
      reason: "Math mismatch",
      requestedByAgent: "ExtractionAgent"
    });

    // 2. Soft-delete the PO via HTTP endpoint
    const delRes = await request(app)
      .delete(`/api/v1/pos/${po1.id}`)
      .set("Authorization", `Bearer ${userToken}`);

    expect(delRes.status).toBe(204);

    // Verify PO status is DELETED
    const fetchedPo1 = await PurchaseOrderRepository.findById(tenantId, po1.id);
    expect(fetchedPo1?.status).toBe("DELETED");
    expect(fetchedPo1?.deletedAt).toBeDefined();

    // Verify open review is REJECTED
    const fetchedReview = await ReviewRepository.findById(tenantId, review.id);
    expect(fetchedReview?.status).toBe("REJECTED");

    // 3. Create a new PO with the SAME poNumber
    const sampleBuffer = Buffer.from("%PDF-1.4 Reused PO");
    const createRes = await request(app)
      .post("/api/v1/pos")
      .set("Authorization", `Bearer ${userToken}`)
      .field("poNumber", poNumber)
      .field("customerName", "New Replacement Corp")
      .attach("file", sampleBuffer, "po2.pdf");

    expect(createRes.status).toBe(202);
    expect(createRes.body.poId).toBeDefined();
    expect(createRes.body.poId).not.toBe(po1.id);

    // Verify newly created PO in repository
    const fetchedNewPo = await PurchaseOrderRepository.findById(tenantId, createRes.body.poId);
    expect(fetchedNewPo?.poNumber).toBe(poNumber);
    expect(fetchedNewPo?.status).toBe("PROCESSING");
  });

  it("allows reusing a PO number if previous PO was REJECTED or FAILED", async () => {
    const poNumber = "PO-FAILED-REUSE-100";

    // Create failed PO
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber,
      customerName: "Failed Corp",
      gstNumber: "29AABCU9603R1ZM",
      status: "FAILED",
      failureReason: "Parsing error",
      s3Key: "pos/failed.pdf",
      documentName: "failed.pdf",
      documentSize: 1024,
      contentType: "application/pdf"
    });

    // New PO with same number should succeed
    const newPo = await PurchaseOrderRepository.create(tenantId, {
      poNumber,
      customerName: "Failed Corp Retry",
      gstNumber: "29AABCU9603R1ZM",
      status: "UPLOADED",
      s3Key: "pos/retry.pdf",
      documentName: "retry.pdf",
      documentSize: 1024,
      contentType: "application/pdf"
    });

    expect(newPo.id).not.toBe(po.id);
    expect(newPo.poNumber).toBe(poNumber);
  });
});
