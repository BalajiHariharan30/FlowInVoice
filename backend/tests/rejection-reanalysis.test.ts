import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  PurchaseOrderRepository,
  ReviewRepository,
  ProductRepository,
  AuditRepository,
  clearTestRepositories
} from "../src/repositories/index.js";
import { QdrantService } from "../src/rag/qdrant.service.js";
import { ReanalysisService } from "../src/ai/workflow/reanalysis.service.js";

function generateAuthToken(tenantId: string, role: any = "REVIEWER"): string {
  return AuthService.generateTokens({
    id: "usr_reviewer_1",
    tenantId,
    email: "reviewer@enterprise.com",
    role,
    name: "Reviewer User"
  }).accessToken;
}

describe("Rejection Re-Analysis Routine & Discrepancy Aggregation (§Bug 1)", () => {
  const tenantId = "test_tenant_reanalysis";
  const app = createApp();
  let token: string;

  beforeEach(() => {
    QdrantService.clearMockStore();
    clearTestRepositories();
    token = generateAuthToken(tenantId);
  });

  it("surfaces BOTH independent issues (price mismatch Node 05 AND bad GSTIN Node 06) when PO is rejected", async () => {
    // 1. Seed Master Catalog: SKU-ALPHA has basePrice = 1000.0
    await ProductRepository.create(tenantId, {
      sku: "SKU-ALPHA",
      name: "Enterprise Data Hub",
      basePrice: 1000.0
    });

    // 2. Create PO with TWO independent defects:
    //    Defect A: unitPrice = 1500.0 (+50% variance, exceeds 10% tolerance -> Node 05)
    //    Defect B: gstNumber = "INVALID_GST_999" (fails statutory 15-char regex -> Node 06)
    const po = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-DUAL-ISSUE-101",
      customerName: "Acme India Pvt Ltd",
      gstNumber: "INVALID_GST_999", // Bad GSTIN
      status: "HUMAN_REVIEW",
      subtotal: 1500.0,
      tax: 270.0,
      discount: 0,
      totalAmount: 1770.0,
      extractionConfidence: 0.95,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-ALPHA",
          description: "Enterprise Data Hub",
          quantity: 1,
          unitPrice: 1500.0, // Bad Price (+50% deviation)
          lineTotal: 1500.0,
          taxRate: 18.0
        }
      ]
    });

    // 3. Create initial HumanReview ticket triggered initially by price
    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: po._id.toString(),
      stage: "validation",
      status: "PENDING",
      priority: "HIGH",
      reason: "Initial flag: Item SKU-ALPHA price deviates 50% from catalog",
      requestedByAgent: "ValidationAgent"
    });

    // 4. Directly test ReanalysisService to verify exhaustive multi-node checks
    const reanalysis = await ReanalysisService.reanalyzePurchaseOrder(tenantId, po._id.toString());
    expect(reanalysis.allNodesPassed).toBe(false);
    expect(reanalysis.discrepancies.length).toBeGreaterThanOrEqual(2);

    const priceDiscrepancy = reanalysis.discrepancies.find((d) => d.nodeId === "05_CONTRACT_RAG");
    expect(priceDiscrepancy).toBeDefined();
    expect(priceDiscrepancy!.field).toContain("unitPrice");
    expect(priceDiscrepancy!.extractedValue).toBe(1500.0);
    expect(priceDiscrepancy!.expectedValue).toBe(1000.0);

    const gstinDiscrepancy = reanalysis.discrepancies.find((d) => d.nodeId === "06_TAX_COMPLIANCE");
    expect(gstinDiscrepancy).toBeDefined();
    expect(gstinDiscrepancy!.field).toBe("gstNumber");
    expect(gstinDiscrepancy!.extractedValue).toBe("INVALID_GST_999");

    // 5. Test rejection HTTP endpoint: POST /reviews/:id/reject
    const res = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Pricing not agreed and vendor tax identifier invalid" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("REJECTED");
    expect(res.body.discrepancyReport).toBeDefined();
    expect(res.body.discrepancyReport.length).toBeGreaterThanOrEqual(2);

    // Verify review was saved with the full discrepancyReport
    const storedReview = await ReviewRepository.findById(tenantId, review._id.toString());
    expect(storedReview).toBeDefined();
    expect(storedReview!.status).toBe("REJECTED");
    expect(storedReview!.discrepancyReport).toBeDefined();
    expect(storedReview!.discrepancyReport!.length).toBeGreaterThanOrEqual(2);

    // Verify PO status is REJECTED
    const storedPo = await PurchaseOrderRepository.findById(tenantId, po._id.toString());
    expect(storedPo!.status).toBe("REJECTED");
    expect(storedPo!.failureReason).toContain("05_CONTRACT_RAG");
    expect(storedPo!.failureReason).toContain("06_TAX_COMPLIANCE");

    // Verify Audit Log records rejection with reanalysis
    const audits = await AuditRepository.findByEntityId(tenantId, po._id.toString());
    const reanalysisAudit = audits.find((a) => a.action === "REVIEW_REJECTED_WITH_REANALYSIS");
    expect(reanalysisAudit).toBeDefined();
    expect(reanalysisAudit!.summary).toContain("Complete pipeline re-analysis identified");
  });

  it("does NOT auto-reject and routes back to Human Review if zero discrepancies remain on re-check", async () => {
    // 1. Seed Master Catalog
    await ProductRepository.create(tenantId, {
      sku: "SKU-BETA",
      name: "Cloud Storage Tier 1",
      basePrice: 500.0
    });

    // 2. Create clean, valid PO
    const validPo = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-CLEAN-202",
      customerName: "Clean Client Tech",
      gstNumber: "27AABCU9603R1ZM", // Valid 15-char GSTIN
      status: "HUMAN_REVIEW",
      subtotal: 500.0,
      tax: 90.0,
      discount: 0,
      totalAmount: 590.0,
      extractionConfidence: 0.98,
      lineItems: [
        {
          lineNumber: 1,
          productCode: "SKU-BETA",
          description: "Cloud Storage Tier 1",
          quantity: 1,
          unitPrice: 500.0, // Matches catalog exactly
          lineTotal: 500.0,
          taxRate: 18.0
        }
      ]
    });

    // 3. Create review ticket
    const review = await ReviewRepository.create(tenantId, {
      entity: "purchase_order",
      entityId: validPo._id.toString(),
      stage: "validation",
      status: "PENDING",
      reason: "Stale exception flag",
      requestedByAgent: "ValidationAgent"
    });

    // 4. Calling reject when PO has no discrepancies
    const res = await request(app)
      .post(`/api/v1/reviews/${review._id.toString()}/reject`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "Attempting to reject already clean document" });

    expect(res.status).toBe(200);
    // Should remain PENDING with confirmation note
    expect(res.body.status).toBe("PENDING");
    expect(res.body.resolutionNotes).toContain("Resolved on re-check. No discrepancies found within tolerance");

    // PO should NOT be marked REJECTED
    const storedPo = await PurchaseOrderRepository.findById(tenantId, validPo._id.toString());
    expect(storedPo!.status).not.toBe("REJECTED");
  });
});
