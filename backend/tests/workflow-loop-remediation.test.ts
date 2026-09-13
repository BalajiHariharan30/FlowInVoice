import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  InvoiceRepository,
  ProductRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { QueueManager } from "../src/workers/queue.js";
import { isValidPOTransition } from "../src/ai/workflow/workflow-state-machine.js";

function generateAuthToken(tenantId: string, role: any = "ADMIN"): string {
  return AuthService.generateTokens({
    id: "usr_ops_admin_99",
    tenantId,
    email: "opsadmin@flowinvoice.io",
    role,
    name: "Ops Admin"
  }).accessToken;
}

describe("Workflow Loop, State, Queue & Agent Remediation Test Suite", () => {
  const tenantId = "tenant_remediation_test";
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

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Double Approve Idempotency
  // ──────────────────────────────────────────────────────────────────────────
  it("1. Double Approve: subsequent approve calls return 200 OK without duplicate resume or duplicate tickets", async () => {
    // Seed product so line matching passes
    await ProductRepository.create(tenantId, {
      sku: "SKU-SERVER-01",
      name: "Compute Node",
      basePrice: 2000.0
    });

    // Create PO in HUMAN_REVIEW with 1 line item
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-LOOP-TEST-001",
      customerName: "Acme Enterprises",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_REVIEW",
      subtotal: 2000.0,
      tax: 360.0,
      discount: 0,
      totalAmount: 2360.0,
      extractionConfidence: 0.65, // low confidence
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-SERVER-01",
          description: "Compute Node",
          quantity: 1,
          unitPrice: 2000.0,
          lineTotal: 2000.0,
          taxRate: 18.0
        }
      ]
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "Extraction confidence below 75%",
      requestedByAgent: "ExtractionAgent"
    });

    // Spy on QueueManager.addPOResumeJob
    const addResumeJobSpy = vi.spyOn(QueueManager, "addPOResumeJob");

    // First approve call
    const res1 = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Approved by ops lead" });

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe("APPROVED");
    expect(addResumeJobSpy).toHaveBeenCalledTimes(1);

    // Second approve call (simulating user double-click or replay)
    const res2 = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Accidental second click" });

    // Must be idempotent 200 OK without re-triggering resume job!
    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("APPROVED");
    expect(res2.body.message).toContain("already approved");
    expect(addResumeJobSpy).toHaveBeenCalledTimes(1); // STILL 1, no duplicate!

    // Verify review remains APPROVED
    const finalReview = await ReviewRepository.findById(tenantId, review._id.toString());
    expect(finalReview?.status).toBe("APPROVED");

    // Verify pending review queue contains 0 items for this PO
    const pendingReviews = await ReviewRepository.findByEntityId(tenantId, po._id.toString());
    const openTickets = pendingReviews.filter((r) => r.status === "PENDING" || r.status === "ESCALATED");
    expect(openTickets.length).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Double Reject Idempotency
  // ──────────────────────────────────────────────────────────────────────────
  it("2. Double Reject: subsequent reject calls return 200 OK and PO remains terminal REJECTED", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-LOOP-TEST-002",
      customerName: "Suspicious Vendor Ltd",
      gstNumber: "99BADTAXID00000",
      status: "HUMAN_REVIEW",
      subtotal: 5000.0,
      tax: 0,
      discount: 0,
      totalAmount: 5000.0,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-UNKNOWN",
          description: "Unverified Service",
          quantity: 1,
          unitPrice: 5000.0,
          lineTotal: 5000.0,
          taxRate: 0
        }
      ]
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "CRITICAL",
      reason: "Tax ID format invalid and suspicious vendor",
      requestedByAgent: "ValidationAgent"
    });

    // First reject call
    const res1 = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Rejected: invalid credentials" });

    expect(res1.status).toBe(200);
    expect(res1.body.status).toBe("REJECTED");

    // Second reject call
    const res2 = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Rejected again" });

    expect(res2.status).toBe(200);
    expect(res2.body.status).toBe("REJECTED");
    expect(res2.body.message).toContain("already rejected");

    // Verify PO status is REJECTED
    const finalPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(finalPo?.status).toBe("REJECTED");

    // Verify Review is REJECTED
    const finalReview = await ReviewRepository.findById(tenantId, review._id.toString());
    expect(finalReview?.status).toBe("REJECTED");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Cross-State Conflict (Cannot Approve Rejected, Cannot Reject Approved)
  // ──────────────────────────────────────────────────────────────────────────
  it("3. Cross-State Conflict: rejects invalid cross-state transitions with 409 Conflict", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CONFLICT-003",
      customerName: "State Conflict Corp",
      status: "HUMAN_REVIEW",
      subtotal: 1000.0,
      totalAmount: 1000.0,
      lineItems: []
    });

    const reviewApproved = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Pricing deviation"
    });

    // Approve the ticket
    await request(app)
      .post(`/api/v1/reviews/${reviewApproved._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Approved" });

    // Now try to REJECT the approved ticket -> 409 Conflict
    const rejectAttempt = await request(app)
      .post(`/api/v1/reviews/${reviewApproved._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Changed my mind" });

    expect(rejectAttempt.status).toBe(409);
    expect(rejectAttempt.body.code).toBe("CANNOT_REJECT_APPROVED_REVIEW");

    // Create a new rejected review
    const reviewRejected = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Fraud check"
    });

    // Reject it
    await request(app)
      .post(`/api/v1/reviews/${reviewRejected._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Confirmed fraudulent" });

    // Now try to APPROVE the rejected ticket -> 409 Conflict
    const approveAttempt = await request(app)
      .post(`/api/v1/reviews/${reviewRejected._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Un-reject attempt" });

    expect(approveAttempt.status).toBe(409);
    expect(approveAttempt.body.code).toBe("CANNOT_APPROVE_REJECTED_REVIEW");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. No Human Review Resurrection
  // ──────────────────────────────────────────────────────────────────────────
  it("4. No Review Resurrection: once human-approved, resuming pipeline never creates secondary review tickets", async () => {
    // Seed product
    await ProductRepository.create(tenantId, {
      sku: "SKU-CLEAN",
      name: "Clean Product",
      basePrice: 500.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESURRECT-TEST",
      customerName: "Resurrection Shield Co",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_REVIEW",
      subtotal: 500.0,
      tax: 90.0,
      discount: 0,
      totalAmount: 590.0,
      extractionConfidence: 0.60, // weak confidence initially
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-CLEAN",
          description: "Clean Product",
          quantity: 1,
          unitPrice: 500.0,
          lineTotal: 500.0,
          taxRate: 18.0
        }
      ]
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "extraction",
      status: "PENDING",
      priority: "HIGH",
      reason: "Extraction confidence below 75%",
      requestedByAgent: "ExtractionAgent"
    });

    // Approve the review
    const approveRes = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Manually verified line items and signed off" });

    expect(approveRes.status).toBe(200);

    // Wait for in-memory async resume queue worker to run
    await new Promise((r) => setTimeout(r, 800));

    // Verify all reviews for this entity: exactly 1 review exists, and its status is APPROVED!
    const allReviews = await ReviewRepository.findByEntityId(tenantId, po._id.toString());
    expect(allReviews.length).toBe(1);
    expect(allReviews[0].status).toBe("APPROVED");

    // Zero pending tickets
    const pending = allReviews.filter((r) => r.status === "PENDING");
    expect(pending.length).toBe(0);

    // PO transitioned to COMPLETED
    const updatedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPo?.status).toBe("COMPLETED");

    // Invoice was created
    const invoice = await InvoiceRepository.findByPoId(tenantId, po._id.toString());
    expect(invoice).toBeDefined();
    expect(invoice?.status).toBe("ISSUED");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. >3 Flags Scenario / Bounded Remedy
  // ──────────────────────────────────────────────────────────────────────────
  it("5. >3 Flags Scenario: flags >= 4 are marked CRITICAL with structured diagnosis and do not loop", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-MULTI-FLAG-005",
      customerName: "Multi Error Client",
      status: "VALIDATING",
      subtotal: 1000.0,
      totalAmount: 1000.0,
      extractionConfidence: 0.95, // Passes extraction, hits validation
      lineItems: [
        {
          lineNumber: 1,
          productCode: "GHOST-SKU-99", // Flag 1: uncataloged >= $1000
          description: "Ghost Item",
          quantity: 1,
          unitPrice: 1000.0,
          lineTotal: 1200.0, // Flag 2: math mismatch (1000 != 1200)
          taxRate: 18.0
        },
        {
          lineNumber: 2,
          productCode: "GHOST-SKU-88", // Flag 3: uncataloged >= $1000
          description: "Ghost Item 2",
          quantity: 1,
          unitPrice: 1500.0,
          lineTotal: 1700.0, // Flag 4: math mismatch (1500 != 1700)
          taxRate: 18.0
        }
      ]
    });

    // Trigger deterministic workflow
    const { runOrchestrationWorkflow } = await import("../src/ai/workflow/deterministic.js");
    const result = await runOrchestrationWorkflow(tenantId, po._id.toString());

    expect(result.status).toBe("HUMAN_REVIEW");
    expect(result.isBusinessException).toBe(true);

    // Fetch created review ticket
    const reviews = await ReviewRepository.findByEntityId(tenantId, po._id.toString());
    expect(reviews.length).toBeGreaterThanOrEqual(1);

    const ticket = reviews[0];
    // Priority must be CRITICAL for multi-error or math mismatch
    expect(ticket.priority).toBe("CRITICAL");
    expect(ticket.status).toBe("PENDING");

    // Diagnosis suggestedFix should be present
    expect(ticket.suggestedFix).toBeDefined();
    expect(ticket.suggestedFix?.rootCauseCategory).toBeDefined();
    expect(ticket.suggestedFix?.recommendedAction).toBeDefined();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Duplicate Invoice Protection
  // ──────────────────────────────────────────────────────────────────────────
  it("6. Duplicate Invoice Protection: returns existing invoice and prevents duplicate creation", async () => {
    // Create completed PO with invoice already issued
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-INV-TEST-006",
      customerName: "Enterprise Client",
      status: "COMPLETED",
      subtotal: 2000.0,
      tax: 360.0,
      totalAmount: 2360.0,
      lineItems: []
    });

    const initialInvoice = await InvoiceRepository.create(tenantId, {
      invoiceNumber: "INV-INV-TEST-006",
      poId: po._id.toString(),
      poNumber: po.poNumber,
      customerName: po.customerName,
      status: "ISSUED",
      subtotal: 2000.0,
      tax: 360.0,
      totalAmount: 2360.0,
      currency: "INR",
      issueDate: new Date(),
      dueDate: new Date(),
      lineItems: []
    });

    // Call POST /invoices/:poId/generate
    const res1 = await request(app)
      .post(`/api/v1/invoices/${po._id.toString()}/generate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res1.status).toBe(200);
    expect(res1.body.invoiceNumber).toBe(initialInvoice.invoiceNumber);
    expect(res1.body.message).toContain("already exists");

    // Call again
    const res2 = await request(app)
      .post(`/api/v1/invoices/${po._id.toString()}/generate`)
      .set("Authorization", `Bearer ${token}`);

    expect(res2.status).toBe(200);
    expect(res2.body.invoiceNumber).toBe(initialInvoice.invoiceNumber);

    // Verify only 1 invoice exists for this PO
    const allInvoices = await InvoiceRepository.findMany(tenantId, { page: 1, pageSize: 50 });
    const matching = allInvoices.data.filter((inv) => inv.poId === po._id.toString());
    expect(matching.length).toBe(1);

    // Attempting to generate invoice for a REJECTED PO returns 400
    const rejectedPo = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-REJECTED-007",
      customerName: "Rejected Vendor",
      status: "REJECTED",
      subtotal: 100.0,
      totalAmount: 100.0,
      lineItems: []
    });

    const rejectInvRes = await request(app)
      .post(`/api/v1/invoices/${rejectedPo._id.toString()}/generate`)
      .set("Authorization", `Bearer ${token}`);

    expect(rejectInvRes.status).toBe(400);
    expect(rejectInvRes.body.code).toBe("INVALID_PO_STATE");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Authoritative State Machine Transitions
  // ──────────────────────────────────────────────────────────────────────────
  it("7. State Machine: blocks illegal transitions and updates version on valid transitions", async () => {
    // 7.1 Static validator checks
    expect(isValidPOTransition("UPLOADED", "PROCESSING")).toBe(true);
    expect(isValidPOTransition("PROCESSING", "EXTRACTED")).toBe(true);
    expect(isValidPOTransition("COMPLETED", "PROCESSING")).toBe(false); // Illegal
    expect(isValidPOTransition("REJECTED", "APPROVED")).toBe(false);    // Illegal
    expect(isValidPOTransition("COMPLETED", "DELETED")).toBe(true);      // Soft delete allowed

    // 7.2 Repository enforcement
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-STATE-TEST-008",
      customerName: "State Test Co",
      status: "COMPLETED",
      subtotal: 100.0,
      totalAmount: 100.0,
      lineItems: []
    });

    expect(po.status).toBe("COMPLETED");
    const initialVersion = po.version || 1;

    // Attempt illegal transition: COMPLETED -> PROCESSING
    const illegalUpdate = await PurchaseOrderRepository.updateStatus(tenantId, po._id.toString(), "PROCESSING");
    expect(illegalUpdate).toBeNull(); // Blocked by state machine!

    // Verify status remains COMPLETED
    const checkPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(checkPo?.status).toBe("COMPLETED");

    // Allowed transition: COMPLETED -> DELETED
    const validUpdate = await PurchaseOrderRepository.updateStatus(tenantId, po._id.toString(), "DELETED");
    expect(validUpdate).not.toBeNull();
    expect(validUpdate?.status).toBe("DELETED");
    expect(validUpdate?.version).toBeGreaterThan(initialVersion);
  });
});
