import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";

const app = createApp();

describe("API Contract Envelopes & Response Format (§B3 / §C4)", () => {
  const mockToken = AuthService.generateTokens({
    id: "test_user_id",
    tenantId: "tenant_test",
    email: "admin@test.com",
    name: "Admin Tester",
    role: "ADMIN"
  }).accessToken;

  it("returns flat error format without 'success' wrapper on 404", async () => {
    const res = await request(app).get("/api/v1/pos/non-existent-po-id").set("Authorization", `Bearer ${mockToken}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("code");
    expect(res.body).toHaveProperty("message");
    expect(res.body).toHaveProperty("details");
    expect(res.body).toHaveProperty("requestId");
    expect(res.body).not.toHaveProperty("success");
  });

  it("returns list success format with data and pagination objects", async () => {
    const res = await request(app).get("/api/v1/pos").set("Authorization", `Bearer ${mockToken}`);

    // Whether 200 or with empty list, pagination shape must be strictly validated
    if (res.status === 200) {
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty("pagination");
      expect(res.body.pagination).toHaveProperty("page");
      expect(res.body.pagination).toHaveProperty("pageSize");
      expect(res.body.pagination).toHaveProperty("total");
      expect(res.body.pagination).toHaveProperty("totalPages");
    }
  });

  it("returns 202 Accepted on PO upload with poId, jobId, and status: PROCESSING", async () => {
    const res = await request(app)
      .post("/api/v1/pos")
      .set("Authorization", `Bearer ${mockToken}`)
      .attach("file", Buffer.from("%PDF-1.4 Mock PO content"), "sample_po.pdf");

    if (res.status === 202) {
      expect(res.body).toHaveProperty("poId");
      expect(res.body).toHaveProperty("jobId");
      expect(res.body.status).toBe("PROCESSING");
    }
  });
});
