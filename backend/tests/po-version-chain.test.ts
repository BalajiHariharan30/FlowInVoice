import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import { PurchaseOrderRepository, clearTestRepositories } from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

function generateAuthToken(tenantId: string, userId: string = "usr_finance_1"): string {
  return AuthService.generateTokens({
    id: userId,
    tenantId,
    email: "finance@enterprise.com",
    role: "FINANCE",
    name: "Finance User"
  }).accessToken;
}

describe("Fix 2: PO Version Grouping & Lineage Chain Test Suite", () => {
  const tenantId = "tenant_version_chain_test";
  const app = createApp();

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links a 3-version resubmission chain (v1 rejected -> v2 rejected -> v3 approved), fetches complete timeline, and filters superseded versions by default", async () => {
    const token = generateAuthToken(tenantId);

    // 1. Initial Submission: Version 1 (fails validation / rejected)
    const v1 = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-REVISION-101",
      customerName: "Tata Motors Ltd",
      status: "REJECTED",
      version: 1,
      totalAmount: 1000,
      createdBy: "usr_submitter_1",
      failureReason: "Price variance 25%"
    });
    const v1Id = v1._id.toString();

    // 2. First Correction: Version 2 (rejected due to incorrect GSTIN)
    const v2 = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-REVISION-101",
      customerName: "Tata Motors Ltd",
      status: "REJECTED",
      version: 2,
      previousVersionId: v1Id,
      totalAmount: 1100,
      createdBy: "usr_submitter_1",
      failureReason: "Statutory GSTIN invalid"
    });
    const v2Id = v2._id.toString();

    // 3. Final Correction: Version 3 (approved and active)
    const v3 = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-REVISION-101",
      customerName: "Tata Motors Ltd",
      status: "COMPLETED",
      version: 3,
      previousVersionId: v2Id,
      totalAmount: 1180,
      createdBy: "usr_submitter_1"
    });
    const v3Id = v3._id.toString();

    // 4. Also create another unrelated standalone PO to verify general listing isolation
    const otherPo = await PurchaseOrderRepository.create(tenantId, {
      poNumber: "PO-STANDALONE-500",
      customerName: "Infosys Ltd",
      status: "COMPLETED",
      version: 1,
      totalAmount: 5000,
      createdBy: "usr_submitter_2"
    });
    const otherPoId = otherPo._id.toString();

    // 5. Default Listing: GET /pos (latestOnly=true) must return ONLY v3 and otherPo (superseded v1, v2 filtered out)
    const defaultListRes = await request(app)
      .get("/api/v1/pos")
      .set("Authorization", `Bearer ${token}`);

    expect(defaultListRes.status).toBe(200);
    expect(defaultListRes.body.data.length).toBe(2);

    const returnedIds = defaultListRes.body.data.map((p: any) => p.id);
    expect(returnedIds).toContain(v3Id);
    expect(returnedIds).toContain(otherPoId);
    expect(returnedIds).not.toContain(v1Id);
    expect(returnedIds).not.toContain(v2Id);

    // 6. Explicit Listing with latestOnly=false must return all 4 records
    const allListRes = await request(app)
      .get("/api/v1/pos?latestOnly=false")
      .set("Authorization", `Bearer ${token}`);

    expect(allListRes.status).toBe(200);
    expect(allListRes.body.data.length).toBe(4);

    // 7. Test Version Chain API from ANY node in the lineage (v1, v2, or v3)
    const chainFromV2Res = await request(app)
      .get(`/api/v1/pos/${v2Id}/version-chain`)
      .set("Authorization", `Bearer ${token}`);

    expect(chainFromV2Res.status).toBe(200);
    expect(chainFromV2Res.body.totalVersions).toBe(3);
    expect(chainFromV2Res.body.currentVersionId).toBe(v2Id);

    const chainData = chainFromV2Res.body.data;
    expect(chainData.length).toBe(3);
    expect(chainData[0].id).toBe(v1Id);
    expect(chainData[0].version).toBe(1);
    expect(chainData[0].status).toBe("REJECTED");

    expect(chainData[1].id).toBe(v2Id);
    expect(chainData[1].version).toBe(2);
    expect(chainData[1].status).toBe("REJECTED");

    expect(chainData[2].id).toBe(v3Id);
    expect(chainData[2].version).toBe(3);
    expect(chainData[2].status).toBe("COMPLETED");

    // 8. Direct repository traversal check
    const repoChain = await PurchaseOrderRepository.findVersionChain(tenantId, v3Id);
    expect(repoChain.length).toBe(3);
    expect(repoChain.map((p) => p.version)).toEqual([1, 2, 3]);
  });
});
