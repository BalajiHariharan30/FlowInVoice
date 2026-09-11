import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import { clearTestRepositories, PurchaseOrderRepository } from "../src/repositories/index.js";
import { resetWorkflowRateLimiter } from "../src/ai/workflow/rate-limiter.js";

const app = createApp();

describe("STEP 2 (HIGH) — Close Duplicate-PO Race Condition", () => {
  const tenantId = "tenant_race_test";
  const userToken = AuthService.generateTokens({
    id: "user_race",
    tenantId,
    email: "admin@racetest.com",
    name: "Race Admin",
    role: "ADMIN"
  }).accessToken;

  beforeEach(() => {
    clearTestRepositories();
    resetWorkflowRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles concurrent PO creation: exactly one succeeds and the other fails with DUPLICATE_PO_NUMBER across 20 iterations", async () => {
    for (let i = 1; i <= 20; i++) {
      const duplicatePoNumber = `PO-CONCURRENT-RACE-${i}`;

      const runConcurrent = () =>
        Promise.all([
          PurchaseOrderRepository.create(tenantId, {
            poNumber: duplicatePoNumber,
            customerName: "Race Customer",
            gstNumber: "27AABCU9603R1ZM",
            status: "UPLOADED",
            s3Key: `pos/race_${i}_a.pdf`,
            documentName: `race_${i}_a.pdf`,
            documentSize: 1024,
            contentType: "application/pdf"
          }).then(() => ({ success: true, error: null }))
            .catch((err) => ({ success: false, error: err })),

          PurchaseOrderRepository.create(tenantId, {
            poNumber: duplicatePoNumber,
            customerName: "Race Customer",
            gstNumber: "27AABCU9603R1ZM",
            status: "UPLOADED",
            s3Key: `pos/race_${i}_b.pdf`,
            documentName: `race_${i}_b.pdf`,
            documentSize: 1024,
            contentType: "application/pdf"
          }).then(() => ({ success: true, error: null }))
            .catch((err) => ({ success: false, error: err }))
        ]);

      const [res1, res2] = await runConcurrent();

      const successCount = (res1.success ? 1 : 0) + (res2.success ? 1 : 0);
      const failCount = (!res1.success ? 1 : 0) + (!res2.success ? 1 : 0);

      expect(successCount).toBe(1);
      expect(failCount).toBe(1);

      const failedError = res1.error || res2.error;
      expect(failedError.code).toBe("DUPLICATE_PO_NUMBER");
      expect(failedError.statusCode).toBe(409);
    }
  });

  it("HTTP API level: concurrent POST /pos returns 202 for one and 409 DUPLICATE_PO_NUMBER for the other", async () => {
    const duplicatePoNumber = "PO-HTTP-RACE-01";
    const sampleBuffer = Buffer.from("%PDF-1.4 Mock PO content");

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${userToken}`)
        .field("poNumber", duplicatePoNumber)
        .field("customerName", "HTTP Race Customer")
        .attach("file", sampleBuffer, "po1.pdf"),

      request(app)
        .post("/api/v1/pos")
        .set("Authorization", `Bearer ${userToken}`)
        .field("poNumber", duplicatePoNumber)
        .field("customerName", "HTTP Race Customer")
        .attach("file", sampleBuffer, "po2.pdf")
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([202, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    expect(conflictRes.body.code).toBe("DUPLICATE_PO_NUMBER");
  });
});
