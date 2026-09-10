import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueueManager } from "../src/workers/queue.js";
import { env } from "../src/config/env.js";

describe("QueueManager Resilience & Redis Backoff (§Fix Spec)", () => {
  const originalRequireRedis = env.REQUIRE_REDIS;
  const originalRedisUrl = env.REDIS_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    env.REQUIRE_REDIS = originalRequireRedis;
    env.REDIS_URL = originalRedisUrl;
  });

  it("1. getHealthStatus returns structured queue telemetry", () => {
    const health = QueueManager.getHealthStatus();
    expect(health).toHaveProperty("status");
    expect(["connected", "connecting", "degraded_in_memory"]).toContain(health.status);
    expect(health).toHaveProperty("mode");
    expect(["bullmq", "in-memory"]).toContain(health.mode);
    expect(health).toHaveProperty("provider");
    expect(health).toHaveProperty("isConfigured");
    expect(typeof health.isConfigured).toBe("boolean");
  });

  it("2. addPOProcessingJob successfully returns a valid composite jobId", async () => {
    const tenantId = "tenant_test_queue";
    const poId = "po_test_12345";
    const jobId = await QueueManager.addPOProcessingJob(tenantId, poId);

    expect(jobId).toBeDefined();
    expect(jobId).toContain(tenantId);
    expect(jobId).toContain(poId);
  });

  it("3. initialize() throws a loud error when REQUIRE_REDIS=true and Redis is unreachable", async () => {
    env.REQUIRE_REDIS = true;
    env.REDIS_URL = "redis://invalid-host-9999.local:6379";

    await expect(QueueManager.initialize()).rejects.toThrow(
      /REQUIRE_REDIS=true is enforced, but failed to connect to Redis/i
    );
  });

  it("4. initialize() gracefully degrades with reconnect watcher when REQUIRE_REDIS=false", async () => {
    env.REQUIRE_REDIS = false;
    env.REDIS_URL = "redis://invalid-host-9999.local:6379";

    // Should not throw, should log and degrade
    await QueueManager.initialize();
    const health = QueueManager.getHealthStatus();
    expect(health.status).toBe("degraded_in_memory");
    expect(health.mode).toBe("in-memory");
    expect(health.lastError).toBeDefined();
  });
});
