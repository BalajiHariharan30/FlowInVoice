import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  clearTestRepositories,
  PurchaseOrderRepository,
  InvoiceRepository
} from "../src/repositories/index.js";
import { runOrchestrationWorkflow } from "../src/ai/workflow/graph.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

const app = createApp();

describe("PO Pipeline Concurrency & Storm Resilience (§Part 5)", () => {
  const tenantId = "tenant_concurrency_stress";
  const userToken = AuthService.generateTokens({
    id: "user_concurrency",
    tenantId,
    email: "stress@tenant.com",
    name: "Stress Tester",
    role: "ADMIN"
  }).accessToken;

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
    process.env.UNCATALOGED_SKU_THRESHOLD = "100000";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires 10 concurrent requests for the same PO: exactly 1 accepted (202), 9 rejected with DUPLICATE_PO_NUMBER (409), exactly 1 PO processed and 1 invoice issued", async () => {
    const stormPoNumber = "PO-STORM-10X-CONCURRENT";
    const sampleBuffer = Buffer.from("%PDF-1.4 Stress Test PO Payload");

    // Fire 10 concurrent POST /pos requests simultaneously
    const requests = Array.from({ length: 10 }).map((_, idx) =>
      request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${userToken}`)
        .field("poNumber", stormPoNumber)
        .field("customerName", "Acme Corporation")
        .field("currency", "USD")
        .field("totalAmount", "1000")
        .attach("file", sampleBuffer, `storm_${idx}.pdf`)
    );

    const responses = await Promise.all(requests);

    const statusCounts = responses.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    expect(statusCounts[202]).toBe(1);
    expect(statusCounts[409]).toBe(9);

    const acceptedRes = responses.find((r) => r.status === 202);
    expect(acceptedRes).toBeDefined();
    expect(acceptedRes?.body.status).toBe("PROCESSING");

    const poId = acceptedRes?.body.poId;
    expect(poId).toBeDefined();

    // Verify all 9 rejected requests contain structured DUPLICATE_PO_NUMBER error
    const rejectedResponses = responses.filter((r) => r.status === 409);
    for (const rej of rejectedResponses) {
      expect(rej.body.code).toBe("DUPLICATE_PO_NUMBER");
    }

    // Seed valid extraction data so LangGraph pipeline progresses autonomously to COMPLETED
    await PurchaseOrderRepository.updateExtraction(tenantId, poId, {
      extractionConfidence: 1.0,
      lineItems: [
        {
          itemNumber: 1,
          sku: "STORM-ITEM-1",
          description: "Storm Item 1",
          quantity: 10,
          unitPrice: 100,
          lineTotal: 1000
        }
      ],
      subtotal: 1000,
      tax: 0,
      totalAmount: 1000
    });

    // Process the accepted PO through LangGraph orchestration pipeline
    const workflowResult = await runOrchestrationWorkflow(tenantId, poId);
    expect(workflowResult.status).toBe("COMPLETED");

    // Verify exactly 1 PO exists for this tenant
    const pos = await PurchaseOrderRepository.findMany(tenantId, { latestOnly: false });
    expect(pos.data.length).toBe(1);
    expect(pos.data[0].poNumber).toBe(stormPoNumber);
    expect(pos.data[0].status).toBe("COMPLETED");

    // Verify exactly 1 invoice was created in total
    const invoices = await InvoiceRepository.findMany(tenantId, { page: 1, pageSize: 20 });
    expect(invoices.data.length).toBe(1);
    expect(invoices.data[0].poNumber).toBe(stormPoNumber);
  });
});
