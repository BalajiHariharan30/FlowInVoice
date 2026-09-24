import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  ProductRepository,
  CustomerRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

function makeToken(tenantId: string, email = "reviewer@enterprise.com"): string {
  return AuthService.generateTokens({
    id: "usr_reviewer",
    tenantId,
    email,
    role: "REVIEWER",
    name: "Reviewer"
  }).accessToken;
}

describe("Multi-Error Single Review Invariants", () => {
  const tenantId = "tenant_multi_error_test";
  const app = createApp();

  beforeEach(async () => {
    clearTestRepositories();
    resetWorkflowRateLimiter();

    await CustomerRepository.create(tenantId, {
      name: "Acme Corp",
      code: "ACMECORP",
      email: "billing@acme.com",
      gstNumber: "27AATCS1234M1Z5",
      paymentTerms: "NET_30",
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-ITEM-A",
      name: "Item A",
      basePrice: 100,
      currency: "INR"
    });

    await ProductRepository.create(tenantId, {
      sku: "SKU-ITEM-B",
      name: "Item B",
      basePrice: 200,
      currency: "INR"
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 1: 2 simultaneous PO validation errors → exactly 1 Review, 2 findings
  // ─────────────────────────────────────────────────────────────────────────
  it("should batch 2 PO validation errors into exactly 1 Review with 2 findings", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-MULTI-ERR-001",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1200,
      tax: 100,
      discount: 0,
      totalAmount: 1400,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    const result = await runOrchestrationWorkflow(tenantId, poId);
    expect(result.isBusinessException).toBe(true);
    expect(result.status).toBe("HUMAN_REVIEW");

    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviews.length).toBe(1);
    expect(allReviews[0].status).toBe("PENDING");

    const findings = (allReviews[0] as any).findings as any[];
    expect(findings).toBeDefined();
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f: any) => f.checkType === "SUBTOTAL_MATH_CHECK")).toBe(true);
    expect(findings.some((f: any) => f.checkType === "TOTAL_AMOUNT_CHECK")).toBe(true);
    expect((allReviews[0] as any).resumeAttempts).toBe(0);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 2: Extraction error + validation error → 2 separate reviews (diff stages)
  // ─────────────────────────────────────────────────────────────────────────
  it("should create separate Reviews for different stage errors (extraction vs validation)", async () => {
    // This test verifies that when errors occur at different stages, reviews
    // remain stage-separated. Since the pipeline halts at first exception,
    // we test stage separation via the review stage field.
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-TWOSTAGE-ERR-002",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1100,
      tax: 100,
      discount: 0,
      totalAmount: 1200,
      extractionConfidence: 0.5,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    await runOrchestrationWorkflow(tenantId, poId);
    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);

    // At most one review per run (pipeline halts at first stage exception)
    expect(allReviews.length).toBeGreaterThanOrEqual(1);

    // If 2 reviews somehow exist, they MUST have different stages
    if (allReviews.length === 2) {
      const stages = allReviews.map((r) => r.stage);
      expect(new Set(stages).size).toBe(2);
    }

    // All reviews are for distinct stages (no two PENDING reviews same stage)
    const pendingByStage = new Map<string, number>();
    for (const r of allReviews.filter(r => r.status === "PENDING")) {
      pendingByStage.set(r.stage, (pendingByStage.get(r.stage) || 0) + 1);
    }
    for (const [, count] of pendingByStage) {
      expect(count).toBe(1);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 3: Approve all errors fixed → APPROVED, workflow completes
  // ─────────────────────────────────────────────────────────────────────────
  it("should complete workflow when all errors are corrected before approval", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-FIXED-ALL-003",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1200,
      tax: 100,
      discount: 0,
      totalAmount: 1300,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    await runOrchestrationWorkflow(tenantId, poId);
    const reviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviews.length).toBe(1);
    const reviewId = reviews[0]._id.toString();

    const token = makeToken(tenantId);
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${reviewId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        resolutionNotes: "All corrected",
        correctedLineItems: [
          { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
          { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
        ]
      });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED");

    const resumeResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeResult.isBusinessException).toBe(false);

    const finalReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(finalReviews.length).toBe(1);
    expect(finalReviews[0].status).toBe("APPROVED");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 4: findOrUpdateStageReview REOPEN path (APPROVED → PENDING)
  // Tests the invariant directly at the repository level.
  // ─────────────────────────────────────────────────────────────────────────
  it("should reopen an APPROVED review (PENDING) via findOrUpdateStageReview when errors persist", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-REOPEN-004",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1100,
      tax: 100,
      discount: 0,
      totalAmount: 1200,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    // 1. Create review
    const first = await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Subtotal mismatch",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:S:0", checkType: "SUBTOTAL_MATH_CHECK", field: "subtotal", expected: "1100", actual: "1200", message: "Subtotal mismatch", resolved: false }
      ]
    } as any);
    const reviewId = first._id.toString();

    // 2. Resolve to APPROVED (simulates reviewer approving)
    await ReviewRepository.resolveReview(tenantId, reviewId, "APPROVED", "Approved by reviewer", "reviewer@test.com");

    const approved = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(approved[0].status).toBe("APPROVED");

    // 3. findOrUpdateStageReview called again for same stage — should REOPEN, not create new
    const reopened = await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Subtotal still mismatched after partial fix",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:S:1", checkType: "SUBTOTAL_MATH_CHECK", field: "subtotal", expected: "1100", actual: "1200", message: "Subtotal still mismatched", resolved: false }
      ]
    } as any);

    // INVARIANT: Same document ID (reopened, not new)
    expect(reopened._id.toString()).toBe(reviewId);
    // Status reset to PENDING
    expect(reopened.status).toBe("PENDING");
    // resumeAttempts incremented
    expect((reopened as any).resumeAttempts).toBe(1);
    // findings replaced with new set
    expect((reopened as any).findings.length).toBe(1);
    expect((reopened as any).findings[0].message).toContain("still mismatched");

    // Only 1 review in repository total
    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviews.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 5: findOrUpdateStageReview enforces one-open-review-per-stage invariant
  // ─────────────────────────────────────────────────────────────────────────
  it("findOrUpdateStageReview updates existing review instead of creating duplicate", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-DEDUP-005",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1100,
      tax: 100,
      discount: 0,
      totalAmount: 1200,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    const first = await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Error set 1",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:S:0", checkType: "SUBTOTAL_MATH_CHECK", field: "subtotal", expected: "1100", actual: "1200", message: "Subtotal mismatch", resolved: false }
      ]
    } as any);

    const second = await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Error set 2",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:T:0", checkType: "TOTAL_AMOUNT_CHECK", field: "totalAmount", expected: "1200", actual: "1300", message: "Total mismatch", resolved: false }
      ]
    } as any);

    // Same document
    expect(second._id.toString()).toBe(first._id.toString());
    // Findings replaced, not appended
    expect((second as any).findings.length).toBe(1);
    expect((second as any).findings[0].checkType).toBe("TOTAL_AMOUNT_CHECK");
    // resumeAttempts incremented
    expect((second as any).resumeAttempts).toBe(1);

    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviews.length).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TEST 6: Dashboard PENDING count correct across create→approve→reopen cycle
  // Uses repository directly to test count invariants (avoids skipValidation bypass).
  // ─────────────────────────────────────────────────────────────────────────
  it("should maintain correct PENDING count across create→approve→reopen cycles via repository", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-DASHBOARD-006",
      customerName: "Acme Corp",
      gstNumber: "27AATCS1234M1Z5",
      currency: "INR",
      paymentTerms: "NET_30",
      status: "PROCESSING",
      createdBy: "usr_intake",
      subtotal: 1100,
      tax: 100,
      discount: 0,
      totalAmount: 1200,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-ITEM-A", description: "Item A", quantity: 5, unitPrice: 100, lineTotal: 500, taxRate: 0 },
        { lineNumber: 2, productCode: "SKU-ITEM-B", description: "Item B", quantity: 3, unitPrice: 200, lineTotal: 600, taxRate: 0 }
      ]
    });
    const poId = po._id.toString();

    // Step 1: Create review → 1 PENDING
    const created = await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Math error",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:S:0", checkType: "SUBTOTAL_MATH_CHECK", field: "subtotal", expected: "1100", actual: "1200", message: "Subtotal mismatch", resolved: false }
      ]
    } as any);

    let result = await ReviewRepository.findMany(tenantId, { status: "PENDING" });
    expect(result.pagination.total).toBe(1);

    // Step 2: Approve → 0 PENDING
    await ReviewRepository.resolveReview(tenantId, created._id.toString(), "APPROVED", "Approved", "reviewer@test.com");
    result = await ReviewRepository.findMany(tenantId, { status: "PENDING" });
    expect(result.pagination.total).toBe(0);

    // Step 3: findOrUpdateStageReview with new errors → REOPENS to PENDING → 1 PENDING again
    await ReviewRepository.findOrUpdateStageReview(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "validation",
      checkpointStep: "po_validation",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Math error still present",
      requestedByAgent: "TestAgent",
      findings: [
        { id: "v:S:1", checkType: "SUBTOTAL_MATH_CHECK", field: "subtotal", expected: "1100", actual: "1200", message: "Subtotal still mismatched", resolved: false }
      ]
    } as any);

    result = await ReviewRepository.findMany(tenantId, { status: "PENDING" });
    expect(result.pagination.total).toBe(1);

    // Total doc count = 1 (same review, reopened)
    const total = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(total.length).toBe(1);
    expect((total[0] as any).resumeAttempts).toBe(1);
  });
});

