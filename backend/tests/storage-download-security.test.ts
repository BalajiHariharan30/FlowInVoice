import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/auth/jwt.js";
import { StorageService } from "../src/storage/s3.service.js";

const app = createApp();

describe("Storage Download Security & Tenant Scoping", () => {
  const tenantA = "tenant_alpha";
  const tenantB = "tenant_beta";

  const userTokenA = AuthService.generateTokens({
    id: "user_a",
    tenantId: tenantA,
    email: "alice@alpha.com",
    name: "Alice Alpha",
    role: "ADMIN"
  }).accessToken;

  const userTokenB = AuthService.generateTokens({
    id: "user_b",
    tenantId: tenantB,
    email: "bob@beta.com",
    name: "Bob Beta",
    role: "ADMIN"
  }).accessToken;

  let tenantAKey: string;
  let tenantBKey: string;

  beforeEach(async () => {
    // Seed test files into mock storage for both tenants
    const uploadA = await StorageService.uploadFile(
      tenantA,
      "pos",
      "po_alpha_123",
      "secret_alpha_po.pdf",
      Buffer.from("%PDF-1.4 Alpha Confidential PO Data"),
      "application/pdf"
    );
    tenantAKey = uploadA.s3Key;

    const uploadB = await StorageService.uploadFile(
      tenantB,
      "pos",
      "po_beta_456",
      "secret_beta_po.pdf",
      Buffer.from("%PDF-1.4 Beta Confidential PO Data"),
      "application/pdf"
    );
    tenantBKey = uploadB.s3Key;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(tenantAKey)}`);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
  });

  it("rejects requests with invalid or expired token with 401 Unauthorized", async () => {
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(tenantAKey)}`)
      .set("Authorization", "Bearer invalid-or-malformed-token");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_TOKEN");
  });

  it("rejects Tenant A trying to download Tenant B file with 403 Forbidden (no 404 leakage)", async () => {
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(tenantBKey)}`)
      .set("Authorization", `Bearer ${userTokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("rejects directory traversal attempts with 403 Forbidden", async () => {
    const maliciousKey = `tenants/${tenantA}/../../${tenantB}/pos/po_beta_456/secret_beta_po.pdf`;
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(maliciousKey)}`)
      .set("Authorization", `Bearer ${userTokenA}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("allows Tenant A to download their own file with Bearer Authorization header", async () => {
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(tenantAKey)}`)
      .set("Authorization", `Bearer ${userTokenA}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("secret_alpha_po.pdf");
    expect(res.body.toString()).toContain("%PDF-1.4 Alpha Confidential PO Data");
  });

  it("allows Tenant A to download their own file with ?token= query parameter", async () => {
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(tenantAKey)}&token=${encodeURIComponent(userTokenA)}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("secret_alpha_po.pdf");
    expect(res.body.toString()).toContain("%PDF-1.4 Alpha Confidential PO Data");
  });

  it("returns 404 for a properly scoped but non-existent file of the requesting tenant", async () => {
    const nonExistentKey = `tenants/${tenantA}/pos/po_alpha_123/does_not_exist.pdf`;
    const res = await request(app)
      .get(`/api/v1/storage/download?key=${encodeURIComponent(nonExistentKey)}`)
      .set("Authorization", `Bearer ${userTokenA}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });
});
