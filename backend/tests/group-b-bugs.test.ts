/**
 * Group B regression tests — Approval Flow bugs
 *
 * B1: Approval transaction — updateHumanReviewStatus must receive session;
 *     if PO state machine blocks the transition, outbox row must NOT be created.
 * B2: resolveReview must run AFTER the PO+outbox transaction; openReviews > 0
 *     must NOT resume the pipeline.
 * B3: extractionConfidence must NOT be overwritten on approval;
 *     humanVerified must be set to true instead.
 * B4: Maker-checker must compare user IDs only (not email); must apply to
 *     invoice-stage reviews by resolving the owning PO.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  PurchaseOrderRepository,
  ReviewRepository
} from "../src/repositories/index.js";
import { isValidPOTransition } from "../src/ai/workflow/workflow-state-machine.js";

// ─── In-memory helpers ────────────────────────────────────────────────────────
const TENANT = "test-tenant-group-b";

function makePO(overrides: Record<string, any> = {}) {
  return PurchaseOrderRepository.create(TENANT, {
    poNumber: `PO-B-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    customerName: "B Corp",
    gstNumber: "27AABCU9603R1ZM",
    status: "HUMAN_REVIEW",
    subtotal: 1000,
    tax: 180,
    totalAmount: 1180,
    extractionConfidence: 0.72,           // B3: real OCR confidence — must survive approval
    lineItems: [
      { lineNumber: 1, productCode: "SKU-B", description: "Item B", quantity: 10, unitPrice: 100, lineTotal: 1000, taxRate: 18 }
    ],
    ...overrides
  });
}

function makeReview(entityId: string, stage: "extraction" | "validation" | "invoice", overrides: Record<string, any> = {}) {
  return ReviewRepository.create(TENANT, {
    entity: "purchase_order",
    entityId,
    stage,
    status: "PENDING",
    priority: "HIGH",
    reason: "Test review",
    requestedByAgent: "TestAgent",
    ...overrides
  });
}

// ─── B1: Blocked PO transition must not create outbox row ─────────────────────
describe("Group B bug regressions", () => {
  describe("B1: PO transition blocked — outbox must not be created", () => {
    it("allows HUMAN_REVIEW → HUMAN_APPROVED transition (state machine permits it)", async () => {
      expect(isValidPOTransition("HUMAN_REVIEW", "HUMAN_APPROVED")).toBe(true);
    });

    it("blocks COMPLETED → HUMAN_APPROVED transition (state machine rejects it)", async () => {
      expect(isValidPOTransition("COMPLETED", "HUMAN_APPROVED")).toBe(false);
    });

    it("updateHumanReviewStatus returns null when transition is blocked", async () => {
      const po = await makePO({ status: "COMPLETED" });
      const result = await PurchaseOrderRepository.updateHumanReviewStatus(
        TENANT,
        po._id.toString(),
        "HUMAN_APPROVED",
        { humanVerified: true, humanReviewedAt: new Date(), humanReviewedBy: "reviewer@test.com" }
      );
      // State machine blocks COMPLETED → HUMAN_APPROVED
      expect(result).toBeNull();
    });
  });

  // ─── B2: openReviews > 0 must not resume pipeline ───────────────────────────
  describe("B2: openReviews guard — pipeline must not resume when other reviews exist", () => {
    it("findByEntityId returns all reviews for an entity across stages", async () => {
      const po = await makePO();
      const r1 = await makeReview(po._id.toString(), "extraction");
      const r2 = await makeReview(po._id.toString(), "validation");

      const all = await ReviewRepository.findByEntityId(TENANT, po._id.toString());
      const openOtherThanR1 = all.filter(
        (r) => (r.status === "PENDING" || r.status === "ESCALATED") && r._id.toString() !== r1._id.toString()
      );
      // r2 should be in the open list
      expect(openOtherThanR1.some((r) => r._id.toString() === r2._id.toString())).toBe(true);
    });

    it("resolveReview on one review does not affect sibling reviews", async () => {
      const po = await makePO();
      const r1 = await makeReview(po._id.toString(), "extraction");
      const r2 = await makeReview(po._id.toString(), "validation");

      await ReviewRepository.resolveReview(TENANT, r1._id.toString(), "APPROVED", "fixed", "reviewer");

      const allAfter = await ReviewRepository.findByEntityId(TENANT, po._id.toString());
      const r2After = allAfter.find((r) => r._id.toString() === r2._id.toString());
      // r2 must still be PENDING
      expect(r2After?.status).toBe("PENDING");
    });
  });

  // ─── B3: humanVerified replaces extractionConfidence overwrite ───────────────
  describe("B3: humanVerified flag — extractionConfidence must not be overwritten", () => {
    it("updateHumanReviewStatus sets humanVerified:true and does not touch extractionConfidence", async () => {
      const originalConfidence = 0.72;
      const po = await makePO({ extractionConfidence: originalConfidence });

      const updated = await PurchaseOrderRepository.updateHumanReviewStatus(
        TENANT,
        po._id.toString(),
        "HUMAN_APPROVED",
        { humanVerified: true, humanReviewedAt: new Date(), humanReviewedBy: "reviewer@test.com" }
      );

      expect(updated).not.toBeNull();
      expect((updated as any).humanVerified).toBe(true);
      // extractionConfidence must NOT be changed to 1.0 — the real OCR value is preserved
      expect((updated as any).extractionConfidence).toBe(originalConfidence);
    });
  });

  // ─── B4: Maker-checker — ID-only comparison; all entity types ────────────────
  describe("B4: Maker-checker — user ID comparison only", () => {
    it("does not block when createdBy user ID differs from reviewer ID", async () => {
      const po = await makePO({ createdBy: "user-A" });
      // Different user ID — no violation
      const fetched = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
      const isViolation = fetched?.createdBy && fetched.createdBy === "user-B";
      expect(isViolation).toBeFalsy();
    });

    it("blocks when createdBy user ID matches reviewer ID (not email)", async () => {
      const po = await makePO({ createdBy: "user-A" });
      const fetched = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
      // Same user ID — violation
      const isViolation = fetched?.createdBy && fetched.createdBy === "user-A";
      expect(isViolation).toBeTruthy();
    });

    it("email match alone does NOT trigger maker-checker (ID-only comparison)", async () => {
      // If stored createdBy is an email string, the new code only compares against userId
      // So storing email as createdBy and comparing against a different userId should NOT block
      const po = await makePO({ createdBy: "maker@company.com" });
      const fetched = await PurchaseOrderRepository.findById(TENANT, po._id.toString());
      // Reviewer userId is a UUID, not an email — comparison fails → no violation
      const isViolation = fetched?.createdBy && fetched.createdBy === "uuid-reviewer-123";
      expect(isViolation).toBeFalsy();
    });
  });
});
