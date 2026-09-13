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
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { createPostingNode } from "../src/ai/workflow/posting/posting.agent.js";

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

  // ──────────────────────────────────────────────────────────────────────────
  // 8. True Checkpoint Resume - Case A: Extraction Checkpoint
  // ──────────────────────────────────────────────────────────────────────────
  it("8. Case A: Extraction Checkpoint Resume: Extraction executes exactly once; approval resumes at matching", async () => {
    // Seed product so downstream line matching passes
    await ProductRepository.create(tenantId, {
      sku: "SKU-CASE-A",
      name: "Widget A",
      basePrice: 500.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CASE-A-001",
      customerName: "Case A Client",
      status: "PROCESSING",
      extractionConfidence: 0.5, // low confidence pauses at extraction
      lineItems: [
        { lineNumber: 1, productCode: "SKU-CASE-A", description: "Widget A", quantity: 2, unitPrice: 500.0, lineTotal: 1000.0, taxRate: 18.0 }
      ],
      subtotal: 1000.0,
      tax: 180.0,
      totalAmount: 1180.0
    });
    const poId = po._id.toString();

    // Initial run: executes extraction -> routes to exception
    const run1Steps: string[] = [];
    const run1Result = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (evt) => run1Steps.push(evt.step)
    });

    expect(run1Result.status).toBe("HUMAN_REVIEW");
    expect(run1Steps).toContain("extraction");
    expect(run1Steps).toContain("exception");
    expect(run1Steps).not.toContain("matching");

    // Reviewer approves the extraction ticket
    const reviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    const targetReview = reviews[0];
    expect(targetReview.stage).toBe("extraction");

    const approveRes = await request(app)
      .post(`/api/v1/reviews/${targetReview._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Verified low confidence text" });
    expect(approveRes.status).toBe(200);

    // Resumed run: must resume at MATCHING and NOT re-run extraction!
    const resumeSteps: string[] = [];
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (evt) => resumeSteps.push(evt.step)
    }, targetReview._id.toString());

    expect(resumeResult.status).toBe("COMPLETED");
    // Extraction must NOT execute on resume!
    expect(resumeSteps).not.toContain("extraction");
    // Matching and downstream stages MUST execute!
    expect(resumeSteps).toContain("matching");
    expect(resumeSteps).toContain("poValidation");
    expect(resumeSteps).toContain("posting");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. True Checkpoint Resume - Case B: Validation Checkpoint
  // ──────────────────────────────────────────────────────────────────────────
  it("9. Case B: Validation Checkpoint Resume: Extraction & matching do NOT re-run; approval resumes at policy", async () => {
    // Product in catalog with price = 1000, but PO has 1500 (+50% variance, triggers validation exception)
    await ProductRepository.create(tenantId, {
      sku: "SKU-CASE-B",
      name: "Widget B",
      basePrice: 1000.0
    });

    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CASE-B-001",
      customerName: "Case B Client",
      status: "PROCESSING",
      extractionConfidence: 0.99, // high confidence so extraction passes
      lineItems: [
        { lineNumber: 1, productCode: "SKU-CASE-B", description: "Widget B", quantity: 1, unitPrice: 1500.0, lineTotal: 1500.0, taxRate: 18.0 }
      ],
      subtotal: 1500.0,
      tax: 270.0,
      totalAmount: 1770.0
    });
    const poId = po._id.toString();

    // Initial run: extraction and matching pass, but policy/approval variance triggers exception
    const run1Steps: string[] = [];
    const run1Result = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (evt) => run1Steps.push(evt.step)
    });

    expect(run1Result.status).toBe("HUMAN_REVIEW");
    expect(run1Steps).toContain("extraction");
    expect(run1Steps).toContain("matching");

    const reviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    const targetReview = reviews[0];

    const approveRes = await request(app)
      .post(`/api/v1/reviews/${targetReview._id.toString()}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resolutionNotes: "Price variance of 50% approved by finance" });
    expect(approveRes.status).toBe(200);

    // Resumed run: must NOT re-run extraction or matching!
    const resumeSteps: string[] = [];
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (evt) => resumeSteps.push(evt.step)
    }, targetReview._id.toString());

    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeSteps).not.toContain("extraction");
    expect(resumeSteps).not.toContain("matching");
    expect(resumeSteps).toContain("posting");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 10. True Checkpoint Resume - Case C: Invoice / Posting Checkpoint
  // ──────────────────────────────────────────────────────────────────────────
  it("10. Case C: Invoice Checkpoint Resume: Earlier stages do NOT re-run; resumes at posting", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CASE-C-001",
      customerName: "Case C Client",
      status: "HUMAN_APPROVED",
      extractionConfidence: 1.0,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-CASE-C", description: "Widget C", quantity: 1, unitPrice: 300.0, lineTotal: 300.0, taxRate: 18.0 }
      ],
      subtotal: 300.0,
      tax: 54.0,
      totalAmount: 354.0
    });
    const poId = po._id.toString();

    // Create review ticket at stage: invoice
    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: poId,
      stage: "invoice",
      checkpointStep: "posting",
      status: "APPROVED",
      priority: "HIGH",
      reason: "Invoice arithmetic check approved by accountant",
      requestedByAgent: "PostingAgent"
    });

    // Save pipeline state at posting step
    await PurchaseOrderRepository.savePipelineState(tenantId, poId, {
      tenantId,
      poId,
      workflowId: "wf_case_c",
      currentStep: "posting",
      status: "HUMAN_APPROVED",
      validationErrors: []
    });

    const resumeSteps: string[] = [];
    const resumeResult = await runOrchestrationWorkflow(tenantId, poId, {
      onStepUpdate: (evt) => resumeSteps.push(evt.step)
    }, review._id.toString());

    expect(resumeResult.status).toBe("COMPLETED");
    expect(resumeSteps).not.toContain("extraction");
    expect(resumeSteps).not.toContain("matching");
    expect(resumeSteps).not.toContain("poValidation");
    expect(resumeSteps).toContain("posting");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 11. Concurrent Approve & Reject: Exactly One Transition Wins
  // ──────────────────────────────────────────────────────────────────────────
  it("11. Concurrent Approve & Reject: exactly one decision succeeds, mutual exclusion enforced", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CONCURRENT-DECISION-01",
      customerName: "Race Client",
      status: "HUMAN_REVIEW",
      subtotal: 100.0,
      totalAmount: 100.0,
      lineItems: []
    });

    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Race test review",
      requestedByAgent: "ValidationAgent"
    });
    const reviewId = review._id.toString();

    // Fire approve() and reject() concurrently
    const [approveRes, rejectRes] = await Promise.all([
      request(app)
        .post(`/api/v1/reviews/${reviewId}/approve`)
        .set("Authorization", `Bearer ${token}`)
        .send({ resolutionNotes: "Race approve" }),
      request(app)
        .post(`/api/v1/reviews/${reviewId}/reject`)
        .set("Authorization", `Bearer ${token}`)
        .send({ reason: "Race reject" })
    ]);

    const statuses = [approveRes.status, rejectRes.status];
    // Exactly one must succeed (200) and the other must be rejected with 409 Conflict
    expect(statuses).toContain(200);
    expect(statuses).toContain(409);

    // Verify the review has an immutable final status
    const finalizedReview = await ReviewRepository.findById(tenantId, reviewId);
    expect(["APPROVED", "REJECTED"]).toContain(finalizedReview?.status);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 12. Stale Worker Optimistic Concurrency Protection
  // ──────────────────────────────────────────────────────────────────────────
  it("12. Stale Worker Protection: updateStatus rejects stale expectedVersion", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-STALE-WORKER-01",
      customerName: "Stale Worker Corp",
      status: "PROCESSING",
      version: 1,
      subtotal: 100.0,
      totalAmount: 100.0,
      lineItems: []
    });
    const poId = po._id.toString();

    // Worker B advances document to HUMAN_REVIEW, bumping version to 2
    const advanced = await PurchaseOrderRepository.updateHumanReviewStatus(tenantId, poId, "HUMAN_REVIEW");
    expect(advanced?.version).toBe(2);

    // Stale Worker A attempts to write using old expectedVersion: 1
    const staleUpdate = await PurchaseOrderRepository.updateStatus(
      tenantId,
      poId,
      "VALIDATING",
      undefined,
      false,
      1 // Stale expectedVersion
    );

    // Must be rejected
    expect(staleUpdate).toBeNull();

    // Status remains HUMAN_REVIEW
    const current = await PurchaseOrderRepository.findById(tenantId, poId);
    expect(current?.status).toBe("HUMAN_REVIEW");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 13. Queue Deduplication (Multiple rapid enqueues)
  // ──────────────────────────────────────────────────────────────────────────
  it("13. Queue Deduplication: rapid concurrent enqueue calls merge into a single active execution", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-QUEUE-DEDUP-01",
      customerName: "Dedup Corp",
      status: "UPLOADED",
      subtotal: 100.0,
      totalAmount: 100.0,
      lineItems: []
    });
    const poId = po._id.toString();

    // Fire 4 enqueue calls in parallel for the exact same PO
    const jobIds = await Promise.all([
      QueueManager.addPOProcessingJob(tenantId, poId),
      QueueManager.addPOProcessingJob(tenantId, poId),
      QueueManager.addPOProcessingJob(tenantId, poId),
      QueueManager.addPOProcessingJob(tenantId, poId)
    ]);

    // All jobIds are identical deterministic IDs
    expect(jobIds[0]).toBe(`po-process-${tenantId}-${poId}`);
    expect(jobIds[1]).toBe(jobIds[0]);
    expect(jobIds[2]).toBe(jobIds[0]);
    expect(jobIds[3]).toBe(jobIds[0]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 14. Review Deduplication on Concurrent Ingestion
  // ──────────────────────────────────────────────────────────────────────────
  it("14. Review Deduplication: Promise.all concurrent review creations yield exactly 1 pending ticket", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CONCURRENT-REVIEW-01",
      customerName: "Multi Review Corp",
      status: "PROCESSING",
      subtotal: 500.0,
      totalAmount: 500.0,
      lineItems: []
    });
    const poId = po._id.toString();

    const payload = {
      entity: "purchase_order" as const,
      entityId: poId,
      stage: "validation" as const,
      status: "PENDING" as const,
      priority: "HIGH" as const,
      reason: "Concurrent validation deviation trigger",
      requestedByAgent: "ValidationAgent"
    };

    // 3 concurrent creates for the same PO
    const results = await Promise.all([
      ReviewRepository.create(tenantId, payload),
      ReviewRepository.create(tenantId, payload),
      ReviewRepository.create(tenantId, payload)
    ]);

    // All return the exact same canonical review
    expect(results[0]._id.toString()).toBe(results[1]._id.toString());
    expect(results[1]._id.toString()).toBe(results[2]._id.toString());

    // Only 1 review exists for this PO
    const allReviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(allReviews.length).toBe(1);
    expect(allReviews[0].status).toBe("PENDING");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 15. Posting Node Guard on Terminal PO
  // ──────────────────────────────────────────────────────────────────────────
  it("15. Posting Terminal Guard: stale worker reaching posting on a REJECTED PO halts without issuing invoice", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-TERMINAL-POSTING-01",
      customerName: "Terminated Client",
      status: "REJECTED", // Terminated
      subtotal: 1000.0,
      tax: 180.0,
      totalAmount: 1180.0,
      lineItems: [
        { lineNumber: 1, productCode: "SKU-TERM", description: "Item", quantity: 1, unitPrice: 1000.0, lineTotal: 1000.0, taxRate: 18.0 }
      ]
    });
    const poId = po._id.toString();

    // Stale worker executes posting node
    const postingFn = createPostingNode(tenantId);
    const result = await postingFn({
      tenantId,
      poId,
      workflowId: "wf_term_test",
      documentName: "test.pdf",
      s3Key: "test.pdf",
      validationErrors: [],
      validationChecks: [],
      evidence: [],
      policySourceReferences: [],
      matchedLineItems: [],
      allowedVariancePct: 10,
      approvalRequired: false,
      isBusinessException: false,
      isHumanApproved: false,
      skipValidation: false,
      status: "REJECTED",
      currentStep: "posting",
      toolCallCount: 0,
      stepRetries: {}
    });

    expect(result.status).toBe("REJECTED");
    expect(result.currentStep).toBe("terminated");

    // No invoice was created
    const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
    expect(invoice).toBeNull();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 16. Finite Remediation Boundary: Unrecoverable PO Terminates Cleanly
  // ──────────────────────────────────────────────────────────────────────────
  it("16. Remediation Boundary: continuous errors terminate in HUMAN_REVIEW with CRITICAL diagnosis", async () => {
    // Missing all line items so validation continuously fails
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-UNRECOVERABLE-01",
      customerName: "Faulty Corp",
      status: "PROCESSING",
      retryCount: 2, // Already retried twice
      lineItems: []  // Empty line items will trigger validation failure
    });
    const poId = po._id.toString();

    const result = await runOrchestrationWorkflow(tenantId, poId);

    expect(result.status).toBe("HUMAN_REVIEW");
    expect(result.isBusinessException).toBe(true);

    // Verify structured suggestedFix was created due to accumulated error count
    const reviews = await ReviewRepository.findByEntityId(tenantId, poId);
    expect(reviews.length).toBe(1);
    expect(reviews[0].priority).toBe("CRITICAL");
    expect(reviews[0].suggestedFix).toBeDefined();
    expect(reviews[0].suggestedFix?.recommendedAction).toBeDefined();
  });
});
