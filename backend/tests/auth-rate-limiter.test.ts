import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { clearRateLimitStore } from "../src/api/middleware/rate-limiter.js";
import { clearTestRepositories } from "../src/repositories/base.js";

const app = createApp();

describe("Auth Rate Limiter Middleware (§Part 4 Security Hardening)", () => {
  beforeEach(() => {
    clearTestRepositories();
    clearRateLimitStore();
  });

  it("allows up to 5 failed login attempts and blocks the 6th attempt with HTTP 429 and Retry-After header", async () => {
    const payload = {
      email: "attacker@test.com",
      password: "wrongpassword123"
    };

    // Attempts 1 to 5: receive 401 INVALID_CREDENTIALS
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send(payload);

      expect(res.status).toBe(401);
      expect(res.headers["x-ratelimit-remaining"]).toBe(String(5 - i));
    }

    // 6th attempt: blocked with 429 RATE_LIMIT_EXCEEDED
    const blockedRes = await request(app)
      .post("/api/v1/auth/login")
      .send(payload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(blockedRes.headers["retry-after"]).toBeDefined();
    expect(Number(blockedRes.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("blocks rapid refresh token brute force with HTTP 429 after 5 attempts", async () => {
    const payload = {
      refreshToken: "invalid-token-sequence"
    };

    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/v1/auth/refresh")
        .send(payload);

      expect(res.status).toBe(401);
    }

    const blockedRes = await request(app)
      .post("/api/v1/auth/refresh")
      .send(payload);

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
