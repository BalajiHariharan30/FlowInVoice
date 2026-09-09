import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import {
  AuditRepository,
  clearTestRepositories
} from "../src/repositories/index.js";

const app = createApp();

describe("Audit Trail API (GET /api/v1/audit/:entityId)", () => {
  const tokenTenantA = AuthService.generateTokens({
    id: "user_tenant_a",
    tenantId: "tenant_alpha",
    email: "alpha@corp.com",
    name: "Alpha User",
    role: "ADMIN"
  }).accessToken;

  beforeEach(() => {
    clearTestRepositories();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns { data: [...] } structure with audit logs", async () => {
    await AuditRepository.create("tenant_alpha", {
      entityId: "PO-100",
      agentName: "ExtractionAgent",
      action: "EXTRACT_LINE_ITEMS",
      status: "SUCCESS",
      summary: "Extracted 3 line items from sample PDF",
      latency: 120,
      model: "llama-3.3-70b-versatile"
    });

    const res = await request(app)
      .get("/api/v1/audit/PO-100")
      .set("Authorization", `Bearer ${tokenTenantA}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("data");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].entityId).toBe("PO-100");
    expect(res.body.data[0].agentName).toBe("ExtractionAgent");
  });

  it("returns 200 with empty list when no events exist for entity", async () => {
    const res = await request(app)
      .get("/api/v1/audit/NONEXISTENT-ENTITY")
      .set("Authorization", `Bearer ${tokenTenantA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
