import { describe, it, expect } from "vitest";
import { AuthService } from "../src/auth/jwt.js";
import { requireRoles } from "../src/auth/rbac.middleware.js";

describe("Auth & RBAC Service", () => {
  it("generates and validates access and refresh tokens", () => {
    const user = {
      id: "usr_123",
      tenantId: "tenant_abc",
      email: "finance@tenant.com",
      name: "Finance Specialist",
      role: "FINANCE" as const
    };

    const tokens = AuthService.generateTokens(user);
    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();

    const decoded = AuthService.verifyAccessToken(tokens.accessToken);
    expect(decoded.userId).toBe(user.id);
    expect(decoded.tenantId).toBe(user.tenantId);
    expect(decoded.role).toBe("FINANCE");

    const refreshDecoded = AuthService.verifyRefreshToken(tokens.refreshToken);
    expect(refreshDecoded.userId).toBe(user.id);
    expect(refreshDecoded.tenantId).toBe(user.tenantId);
  });

  it("RBAC middleware blocks unauthorized roles and permits allowed roles", () => {
    const middleware = requireRoles("ADMIN", "FINANCE");

    let nextCalled = false;
    const reqAllowed: any = {
      user: { id: "1", role: "FINANCE", tenantId: "t1" }
    };
    const resAllowed: any = {};
    const nextAllowed = () => { nextCalled = true; };

    middleware(reqAllowed, resAllowed, nextAllowed);
    expect(nextCalled).toBe(true);

    let forbiddenCode = 0;
    const reqBlocked: any = {
      user: { id: "2", role: "VIEWER", tenantId: "t1" }
    };
    const resBlocked: any = {
      status: (code: number) => {
        forbiddenCode = code;
        return { json: () => {} };
      }
    };
    middleware(reqBlocked, resBlocked, () => {});
    expect(forbiddenCode).toBe(403);
  });
});
