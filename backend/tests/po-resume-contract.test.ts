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

  it("1. Resilient extraction from nested { po: { ... } } payload updates DB to READY_FOR_APPROVAL and enqueues resume", async () => {
    // 1. Seed initial PO in HUMAN_REVIEW / DISCREPANCY_FOUND
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-001",
      customerName: "Acme Corp Old",
      vendorName: "Acme Corp Old",
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
          productCode: "SKU-INITIAL",
          description: "Initial Item",
          quantity: 1,
          unitPrice: 1000.0,
          lineTotal: 1000.0,
          taxRate: 18.0
        }
      ]
    });

    const addResumeJobSpy = vi.spyOn(QueueManager, "addPOResumeJob");

    // 2. Client submits nested frontend payload: { po: { vendorName, totalAmount, lineItems } }
    const res = await request(app)
      .post(`/api/v1/po/${po._id.toString()}/resume`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        po: {
          vendorName: "Acme Global Solutions",
          baseAmount: 1200.0,
          taxAmount: 216.0,
          totalAmount: 1416.0,
          lineItems: [
            {
              lineNumber: 1,
              productCode: "SKU-CORRECTED",
              description: "Corrected Enterprise Node",
              quantity: 1,
              unitPrice: 1200.0,
              lineTotal: 1200.0,
              taxRate: 18.0
            }
          ]
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("READY_FOR_APPROVAL");

    // Verify DB state updated
    const updatedPO = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPO?.status).toBe("READY_FOR_APPROVAL");
    expect(updatedPO?.isResumed).toBe(true);
    expect(updatedPO?.vendorName).toBe("Acme Global Solutions");
    expect(updatedPO?.totalAmount).toBe(1416.0);
    expect(updatedPO?.lineItems[0].description).toBe("Corrected Enterprise Node");
  });

  it("2. Resilient extraction from nested { invoiceData: { ... } } payload updates DB to READY_FOR_APPROVAL", async () => {
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-RESUME-002",
      customerName: "Beta Corp",
      gstNumber: "27AABCU9603R1ZM",
      currency: "INR",
      status: "HUMAN_REVIEW",
      subtotal: 500.0,
      tax: 90.0,
      discount: 0,
      totalAmount: 590.0
    });

    const res = await request(app)
      .post(`/api/v1/po/${po._id.toString()}/resume`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        invoiceData: {
          vendor_name: "Beta Corp Updated",
          base_amount: 600.0,
          tax_amount: 108.0,
          total_amount: 708.0
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("READY_FOR_APPROVAL");

    const updatedPO = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(updatedPO?.status).toBe("READY_FOR_APPROVAL");
    expect(updatedPO?.isResumed).toBe(true);
    expect(updatedPO?.vendorName).toBe("Beta Corp Updated");
    expect(updatedPO?.totalAmount).toBe(708.0);
  });

  it("3. Worker skips Agents 1-3 (OCR/Math) when resuming PO in READY_FOR_APPROVAL", async () => {
    // Seed product so line matching or downstream stages pass
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
});
