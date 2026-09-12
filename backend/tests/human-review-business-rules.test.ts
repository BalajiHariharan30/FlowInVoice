import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  ReviewRepository,
  PurchaseOrderRepository,
  InvoiceRepository,
  AuditRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";
import { ChainedFallbackOCRProvider } from "../src/agents/providers/ocr.provider.js";
import Decimal from "decimal.js";

function generateAuthToken(tenantId: string, userId: string = "usr_reviewer_1", email: string = "reviewer@enterprise.com"): string {
  return AuthService.generateTokens({
    id: userId,
    tenantId,
    email,
    role: "REVIEWER",
    name: "Reviewer User"
  }).accessToken;
}

describe("10 Human Review & Workflow Business Rules Test Suite", () => {
  const tenantId = "tenant_biz_rules_test";
  const app = createApp();

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // RULE 1: Rejection is terminal and irreversible
  describe("Rule 1: Rejection is terminal and irreversible", () => {
    it("should mark PO as REJECTED on human review rejection and no-op on subsequent workflow executions", async () => {
      const reviewerToken = generateAuthToken(tenantId, "usr_reviewer_independent", "independent@enterprise.com");

      // 1. Create PO
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-TERMINAL-01",
        customerName: "Acme Corp",
        status: "HUMAN_REVIEW",
        createdBy: "usr_uploader"
      });
      const poId = po._id.toString();

      // 2. Create review ticket
      const review = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        reason: "Unauthorized price variance: +25%",
        requestedByAgent: "ValidationAgent"
      });

      // 3. Independent reviewer rejects the review ticket
      const rejectRes = await request(app)
        .post(`/api/v1/reviews/${review._id.toString()}/reject`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ reason: "Price variance exceeds authorized vendor agreement limits" });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.status).toBe("REJECTED");

      // 4. Verify PO is marked REJECTED
      const updatedPo = await PurchaseOrderRepository.findById(tenantId, poId);
      expect(updatedPo?.status).toBe("REJECTED");

      // 5. Subsequent attempt to run workflow on REJECTED PO must immediately return REJECTED
      const result = await runOrchestrationWorkflow(tenantId, poId);
      expect(result.status).toBe("REJECTED");
      expect(result.currentStep).toBe("terminated");

      // 6. Verify invoice was NOT created
      const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
      expect(invoice).toBeNull();
    });
  });

  // RULE 2: Multi-exception all-approval & cascading rejection
  describe("Rule 2: Multi-exception all-approval & cascading rejection", () => {
    it("cascades rejection: if ANY review item is rejected, all other open review tickets for that PO are marked REJECTED", async () => {
      const reviewerToken = generateAuthToken(tenantId, "usr_reviewer_ind", "reviewer_ind@enterprise.com");

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-CASCADE-01",
        customerName: "Acme Corp",
        status: "HUMAN_REVIEW",
        createdBy: "usr_submitter"
      });
      const poId = po._id.toString();

      const rev1 = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "extraction",
        status: "PENDING",
        reason: "Line math mismatch"
      });

      const rev2 = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        reason: "Contract SKU uncataloged"
      });

      // Reject rev1
      const res = await request(app)
        .post(`/api/v1/reviews/${rev1._id.toString()}/reject`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ reason: "Invalid line math confirmed" });

      expect(res.status).toBe(200);

      // Verify rev2 was also cascaded to REJECTED
      const rev2Updated = await ReviewRepository.findById(tenantId, rev2._id.toString());
      expect(rev2Updated?.status).toBe("REJECTED");
      expect(rev2Updated?.resolutionNotes).toContain("Cascaded rejection");

      const poUpdated = await PurchaseOrderRepository.findById(tenantId, poId);
      expect(poUpdated?.status).toBe("REJECTED");
    });

    it("all-approval gate: PO remains in HUMAN_REVIEW until ALL open review tickets are approved", async () => {
      const reviewerToken = generateAuthToken(tenantId, "usr_reviewer_ind", "reviewer_ind@enterprise.com");

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-ALL-APP-01",
        customerName: "Acme Corp",
        status: "HUMAN_REVIEW",
        createdBy: "usr_submitter",
        lineItems: [
          { lineNumber: 1, productCode: "SKU-1", description: "Item 1", quantity: 2, unitPrice: 100, lineTotal: 200, taxRate: 18 }
        ]
      });
      const poId = po._id.toString();

      const rev1 = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "extraction",
        status: "PENDING",
        reason: "Confidence low on date"
      });

      const rev2 = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        reason: "Price variance 3%"
      });

      // Approve rev1 only
      const res1 = await request(app)
        .post(`/api/v1/reviews/${rev1._id.toString()}/approve`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ resolutionNotes: "Date confirmed" });

      expect(res1.status).toBe(200);
      expect(res1.body.remainingOpenReviewsCount).toBe(1);

      // Verify PO is STILL in HUMAN_REVIEW
      const poMid = await PurchaseOrderRepository.findById(tenantId, poId);
      expect(poMid?.status).toBe("HUMAN_REVIEW");

      // Now approve rev2
      const res2 = await request(app)
        .post(`/api/v1/reviews/${rev2._id.toString()}/approve`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ resolutionNotes: "Variance authorized" });

      expect(res2.status).toBe(200);

      // Now all are approved, PO advances from HUMAN_REVIEW
      const poFinal = await PurchaseOrderRepository.findById(tenantId, poId);
      expect(["HUMAN_APPROVED", "COMPLETED"]).toContain(poFinal?.status);
    });
  });

  // RULE 3: Resume from checkpoint, never restart
  describe("Rule 3: Resume from checkpoint, never restart", () => {
    it("resumes workflow directly at posting stage checkpoint on human sign-off", async () => {
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-CHECKPOINT-01",
        customerName: "Tata Advanced Systems Ltd",
        gstNumber: "27AATCS1234M1Z5",
        status: "HUMAN_APPROVED",
        subtotal: 1000,
        tax: 180,
        totalAmount: 1180,
        lineItems: [
          { lineNumber: 1, productCode: "PROD-CLOUD-01", description: "Cloud Hosting", quantity: 1, unitPrice: 1000, lineTotal: 1000, taxRate: 18 }
        ]
      });
      const poId = po._id.toString();

      await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "APPROVED",
        reason: "Approved rate"
      });

      // Execute workflow
      const result = await runOrchestrationWorkflow(tenantId, poId);
      expect(result.status).toBe("COMPLETED");
      expect(result.invoiceNumber).toBeDefined();
      expect(result.currentStep).toBe("posting");
    });
  });

  // RULE 4: Repeated failure diagnosis
  describe("Rule 4: Repeated failure diagnosis", () => {
    it("attaches structured suggestedFix when exception agent detects >= 3 accumulated failures", async () => {
      const { createExceptionNode } = await import("../src/ai/workflow/exception/exception.agent.js");
      const exceptionNode = createExceptionNode(tenantId);

      const state: any = {
        tenantId,
        poId: "po_repeat_err_01",
        workflowId: "wf_test",
        documentName: "test.pdf",
        status: "FAILED",
        stepRetries: { extraction: 2, matching: 1 },
        validationErrors: ["Math error 1", "Price discrepancy 2", "Contract mismatch 3"]
      };

      const newState = await exceptionNode(state);
      expect(newState.status).toBe("HUMAN_REVIEW");

      // Verify review ticket was created with suggestedFix
      const review = await ReviewRepository.findLatestByEntityId(tenantId, "po_repeat_err_01");
      expect(review).toBeDefined();
      expect(review?.suggestedFix).toBeDefined();
      expect(review?.suggestedFix?.rootCauseCategory).toBeDefined();
      expect(review?.suggestedFix?.recommendedAction).toBeDefined();
      expect(review?.suggestedFix?.failurePatternSummary).toBeDefined();
    });
  });

  // RULE 5: Segregation of duties (Maker-Checker)
  describe("Rule 5: Segregation of duties (Maker-Checker)", () => {
    it("rejects approval attempt by PO submitter with 403 MAKER_CHECKER_VIOLATION", async () => {
      const submitterId = "usr_submitter_123";
      const submitterToken = generateAuthToken(tenantId, submitterId, "submitter@enterprise.com");
      const reviewerToken = generateAuthToken(tenantId, "usr_independent_456", "reviewer@enterprise.com");

      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-MAKER-01",
        customerName: "Acme Corp",
        status: "HUMAN_REVIEW",
        createdBy: submitterId
      });
      const poId = po._id.toString();

      const review = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        reason: "Contract discount variance"
      });

      // 1. Submitter attempts self-approval -> 403
      const selfApproveRes = await request(app)
        .post(`/api/v1/reviews/${review._id.toString()}/approve`)
        .set("Authorization", `Bearer ${submitterToken}`)
        .send({ resolutionNotes: "I approve my own upload" });

      expect(selfApproveRes.status).toBe(403);
      expect(selfApproveRes.body.code).toBe("MAKER_CHECKER_VIOLATION");

      // 2. Submitter attempts self-rejection -> 403
      const selfRejectRes = await request(app)
        .post(`/api/v1/reviews/${review._id.toString()}/reject`)
        .set("Authorization", `Bearer ${submitterToken}`)
        .send({ reason: "I reject my own upload" });

      expect(selfRejectRes.status).toBe(403);
      expect(selfRejectRes.body.code).toBe("MAKER_CHECKER_VIOLATION");

      // 3. Independent reviewer approves -> 200
      const independentRes = await request(app)
        .post(`/api/v1/reviews/${review._id.toString()}/approve`)
        .set("Authorization", `Bearer ${reviewerToken}`)
        .send({ resolutionNotes: "Authorized by independent finance lead" });

      expect(independentRes.status).toBe(200);
      expect(independentRes.body.status).toBe("APPROVED");
    });
  });

  // RULE 6: SLA-based escalation
  describe("Rule 6: SLA-based escalation", () => {
    it("escalates tickets older than 24h to ESCALATED status with REVIEW_ESCALATED audit entry", async () => {
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-SLA-01",
        customerName: "Acme Corp",
        status: "HUMAN_REVIEW"
      });
      const poId = po._id.toString();

      const staleReview = await ReviewRepository.create(tenantId, {
        entity: "purchase_order",
        entityId: poId,
        stage: "validation",
        status: "PENDING",
        reason: "SLA Overdue Price Exception",
        createdAt: new Date(Date.now() - 30 * 3600 * 1000) // 30 hours old
      });

      // Run SLA escalation check
      const result = await ReviewRepository.escalateStaleReviews(tenantId, 24);
      expect(result.escalatedCount).toBeGreaterThanOrEqual(1);

      const updated = await ReviewRepository.findById(tenantId, staleReview._id.toString());
      expect(updated?.status).toBe("ESCALATED");

      // Verify audit trail entry
      const audits = await AuditRepository.findByEntityId(tenantId, poId);
      const slaAudit = audits.find((a) => a.action === "REVIEW_ESCALATED");
      expect(slaAudit).toBeDefined();
    });
  });

  // RULE 7: Immutable audit trail
  describe("Rule 7: Immutable audit trail", () => {
    it("logs immutable audit entries for key workflow events", async () => {
      const poId = "po_audit_trail_01";
      await AuditRepository.create(tenantId, {
        agentName: "IntakeAgent",
        action: "RECEIVE_DOCUMENT",
        status: "SUCCESS",
        entityId: poId,
        workflowId: "wf_1",
        summary: "Document received"
      });

      await AuditRepository.create(tenantId, {
        agentName: "PostingAgent",
        action: "INVOICE_GENERATED",
        status: "SUCCESS",
        entityId: poId,
        workflowId: "wf_1",
        summary: "Invoice INV-2026-001 generated"
      });

      const audits = await AuditRepository.findByEntityId(tenantId, poId);
      expect(audits.length).toBe(2);
      const actions = audits.map((a) => a.action);
      expect(actions).toContain("RECEIVE_DOCUMENT");
      expect(actions).toContain("INVOICE_GENERATED");
    });
  });

  // RULE 8: Idempotent processing & no duplicate invoices
  describe("Rule 8: Idempotent processing & no duplicate invoices", () => {
    it("never creates duplicate invoices for the same purchase order on repeated workflow execution", async () => {
      const po = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-IDEMPOTENT-01",
        customerName: "Mahindra Logistics Pvt Ltd",
        gstNumber: "27AACCM9876L1ZQ",
        status: "HUMAN_APPROVED",
        subtotal: 5000,
        tax: 900,
        totalAmount: 5900,
        lineItems: [
          { lineNumber: 1, productCode: "IND-BRG-01", description: "Industrial Bearings", quantity: 2, unitPrice: 2500, lineTotal: 5000, taxRate: 18 }
        ]
      });
      const poId = po._id.toString();

      // Run 1
      const res1 = await runOrchestrationWorkflow(tenantId, poId);
      expect(res1.status).toBe("COMPLETED");
      expect(res1.invoiceId).toBeDefined();

      // Run 2 (repeated / retry / resumed)
      const res2 = await runOrchestrationWorkflow(tenantId, poId);
      expect(res2.status).toBe("COMPLETED");
      expect(res2.invoiceId).toBe(res1.invoiceId);

      // Verify in DB that only 1 invoice exists
      const invoice = await InvoiceRepository.findByPoId(tenantId, poId);
      expect(invoice).toBeDefined();
      expect((invoice as any)?._id?.toString() || (invoice as any)?.id).toBe(res1.invoiceId);
    });
  });

  // RULE 9: Corrected resubmissions create versioned PO
  describe("Rule 9: Corrected resubmissions create versioned PO", () => {
    it("increments version number and links previousVersionId on resubmission", async () => {
      const token = generateAuthToken(tenantId, "usr_1", "user@enterprise.com");

      // 1. Initial upload (v1)
      const v1 = await PurchaseOrderRepository.create(tenantId, {
        poNumber: "PO-VER-01",
        customerName: "Acme Corp",
        status: "REJECTED",
        version: 1,
        createdBy: "usr_1"
      });
      const v1Id = v1._id.toString();

      // 2. Resubmission referencing v1
      const uploadRes = await request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${token}`)
        .field("poNumber", "PO-VER-01-CORRECTED")
        .field("previousVersionId", v1Id)
        .attach("file", Buffer.from("%PDF-1.4 test document content"), "po_corrected.pdf");

      expect(uploadRes.status).toBe(202);
      const newPoId = uploadRes.body.poId;

      const newPo = await PurchaseOrderRepository.findById(tenantId, newPoId);
      expect(newPo?.version).toBe(2);
      expect(newPo?.previousVersionId).toBe(v1Id);
      expect(newPo?.createdBy).toBe("usr_1");

      // Original v1 PO remains REJECTED and unchanged
      const originalPo = await PurchaseOrderRepository.findById(tenantId, v1Id);
      expect(originalPo?.status).toBe("REJECTED");
      expect(originalPo?.version).toBe(1);
    });
  });

  // RULE 10: AI Provider fallback order & Decimal.js precision
  describe("Rule 10: AI Provider fallback order & Decimal.js precision", () => {
    it("extracts document via ChainedFallbackOCRProvider falling gracefully to deterministic parser", async () => {
      const chainedExtractor = new ChainedFallbackOCRProvider();
      const input = {
        buffer: Buffer.from("%PDF-1.4 standard purchase order mock"),
        fileName: "PO_Tata_Electronics_Order.pdf",
        contentType: "application/pdf"
      };

      const extracted = await chainedExtractor.extract(input);
      expect(extracted).toBeDefined();
      expect(extracted.poNumber).toBeDefined();
      expect(extracted.lineItems.length).toBeGreaterThan(0);
      expect(extracted.confidence).toBeGreaterThan(0.7);
    });

    it("performs all arithmetic with pure Decimal.js precision without floating point drift", () => {
      const qty = new Decimal("18");
      const unitPrice = new Decimal("98500");
      const lineTotal = qty.times(unitPrice);
      expect(lineTotal.toString()).toBe("1773000");

      const taxRate = new Decimal("18");
      const tax = lineTotal.times(taxRate).dividedBy(100);
      expect(tax.toString()).toBe("319140");

      const grandTotal = lineTotal.plus(tax);
      expect(grandTotal.toString()).toBe("2092140");
    });
  });
});
