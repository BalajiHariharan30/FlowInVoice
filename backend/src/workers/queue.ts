import { Queue, Worker, Job } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { POProcessingWorkflow } from "../agents/workflow.js";

export interface POProcessingJobData {
  tenantId: string;
  poId: string;
  attempt?: number;
}

export interface QueueHealthInfo {
  status: "connected" | "connecting" | "degraded_in_memory";
  mode: "bullmq" | "in-memory";
  provider: "redis" | "in-memory-staggered";
  isConfigured: boolean;
  connectionType: "url" | "host-port";
  connectAttempts: number;
  lastError: string | null;
}

function getRedisConfig(): { url?: string; options: RedisOptions } {
  const isUrlConfigured = Boolean(env.REDIS_URL && env.REDIS_URL.trim().length > 0);
  const rawUrl = env.REDIS_URL?.trim();

  // Exponential backoff retry strategy for ioredis
  const retryStrategy = (times: number) => {
    // Retry with exponential backoff: 500ms, 1000ms, 2000ms, 4000ms, max 10000ms
    const delay = Math.min(Math.pow(2, Math.min(times, 5)) * 500, 10000);
    logger.warn({ attempt: times, nextRetryMs: delay }, "ioredis: retrying Redis connection with exponential backoff");
    return delay;
  };

  if (isUrlConfigured && rawUrl) {
    const isTls = rawUrl.startsWith("rediss://");
    return {
      url: rawUrl,
      options: {
        maxRetriesPerRequest: null,
        connectTimeout: 10000,
        enableOfflineQueue: false,
        lazyConnect: true,
        tls: isTls ? { rejectUnauthorized: false } : undefined,
        retryStrategy
      }
    };
  }

  return {
    options: {
      host: env.REDIS_HOST || "localhost",
      port: env.REDIS_PORT || 6379,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy
    }
  };
}

function createRedisClient(): Redis {
  const config = getRedisConfig();
  if (config.url) {
    return new Redis(config.url, config.options);
  }
  return new Redis(config.options);
}

export class QueueManager {
  private static queueConnection: Redis | null = null;
  private static workerConnection: Redis | null = null;
  private static poQueue: Queue | null = null;
  private static poWorker: Worker | null = null;
  private static isMock = true;
  private static isConnecting = false;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static lastError: string | null = null;
  private static connectAttempts = 0;

  static async initialize(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const maxStartupAttempts = 3;
    let attempt = 0;
    let lastErr: any = null;

    while (attempt < maxStartupAttempts) {
      attempt++;
      this.connectAttempts = attempt;
      try {
        logger.info(
          {
            attempt,
            maxAttempts: maxStartupAttempts,
            configured: Boolean(env.REDIS_URL || env.REDIS_HOST)
          },
          "QueueManager: Connecting to Redis with exponential backoff"
        );

        await this.closeConnections();

        // Instantiate dedicated Redis connections for Queue and Worker (required by BullMQ)
        this.queueConnection = createRedisClient();
        this.workerConnection = createRedisClient();

        this.queueConnection.on("error", (err) => {
          this.lastError = err.message;
          if (!this.isMock) {
            logger.warn({ err: err.message }, "BullMQ Queue Redis connection warning");
          }
        });

        this.workerConnection.on("error", (err) => {
          this.lastError = err.message;
          if (!this.isMock) {
            logger.warn({ err: err.message }, "BullMQ Worker Redis connection warning");
          }
        });

        // Test connection & latency
        await this.queueConnection.connect();
        await this.queueConnection.ping();
        await this.workerConnection.connect();
        await this.workerConnection.ping();

        // Initialize Queue with dedicated connection
        this.poQueue = new Queue("po-processing", {
          connection: this.queueConnection,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            removeOnComplete: true
          }
        });

        // Initialize Worker with dedicated connection
        this.poWorker = new Worker(
          "po-processing",
          async (job: Job<POProcessingJobData>) => {
            logger.info({ jobId: job.id, data: job.data }, "Processing PO job via live BullMQ worker");
            await POProcessingWorkflow.runWorkflow(job.data.tenantId, job.data.poId);
          },
          { connection: this.workerConnection }
        );

        this.isMock = false;
        this.lastError = null;
        this.isConnecting = false;
        logger.info("BullMQ queue & worker initialized successfully with dedicated live Redis connections");
        return;
      } catch (err: any) {
        lastErr = err;
        this.lastError = err.message;
        logger.warn(
          { attempt, maxAttempts: maxStartupAttempts, err: err.message },
          "QueueManager: Redis connection attempt failed"
        );

        if (attempt < maxStartupAttempts) {
          const waitMs = attempt * 1200;
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    }

    // If all startup attempts exhausted
    await this.closeConnections();
    this.isMock = true;
    this.isConnecting = false;

    if (env.REQUIRE_REDIS) {
      throw new Error(
        `REQUIRE_REDIS=true is enforced, but failed to connect to Redis after ${maxStartupAttempts} attempts: ${lastErr?.message}`
      );
    }

    logger.warn(
      {
        error: lastErr?.message,
        mode: "asynchronous in-memory queue",
        reason: env.REDIS_URL ? "Redis host unreachable or hibernating" : "No REDIS_URL configured"
      },
      "Redis unavailable — operating with asynchronous queue runner (non-blocking). Scheduling background reconnect watcher."
    );

    // Schedule background self-healing reconnect probe for hibernating/sleeping instances
    this.scheduleReconnectWatcher();
  }

  private static scheduleReconnectWatcher(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      if (!this.isMock || this.isConnecting) return;
      try {
        const probeClient = createRedisClient();
        await probeClient.connect();
        await probeClient.ping();
        await probeClient.disconnect();

        logger.info("QueueManager: Detected Redis instance is online! Upgrading queue to live BullMQ worker.");
        if (this.reconnectTimer) {
          clearInterval(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        await this.initialize();
      } catch (_) {
        // Still unreachable or hibernating, continue probing in background
      }
    }, 20000);
  }

  private static async closeConnections(): Promise<void> {
    if (this.poWorker) {
      try {
        await this.poWorker.close();
      } catch (_) {}
      this.poWorker = null;
    }
    if (this.poQueue) {
      try {
        await this.poQueue.close();
      } catch (_) {}
      this.poQueue = null;
    }
    if (this.queueConnection) {
      try {
        this.queueConnection.disconnect();
      } catch (_) {}
      this.queueConnection = null;
    }
    if (this.workerConnection) {
      try {
        this.workerConnection.disconnect();
      } catch (_) {}
      this.workerConnection = null;
    }
  }

  static getHealthStatus(): QueueHealthInfo {
    const isConfigured = Boolean(env.REDIS_URL && env.REDIS_URL.trim().length > 0) || (env.REDIS_HOST !== "localhost" && env.REDIS_HOST !== "127.0.0.1");
    return {
      status: !this.isMock ? "connected" : "degraded_in_memory",
      mode: !this.isMock ? "bullmq" : "in-memory",
      provider: !this.isMock ? "redis" : "in-memory-staggered",
      isConfigured,
      connectionType: env.REDIS_URL ? "url" : "host-port",
      connectAttempts: this.connectAttempts,
      lastError: this.lastError
    };
  }

  static async addPOProcessingJob(tenantId: string, poId: string): Promise<string> {
    const jobId = `${tenantId}:${poId}:${Date.now()}`;

    if (!this.isMock && this.poQueue) {
      try {
        await this.poQueue.add(
          "process-po",
          { tenantId, poId, attempt: 1 },
          { jobId }
        );
        logger.info({ jobId, queue: "po-processing" }, "Successfully enqueued PO job to BullMQ");
        return jobId;
      } catch (err: any) {
        logger.warn({ err: err.message, jobId }, "BullMQ enqueue failed, executing with asynchronous runner");
      }
    }

    // Realistic asynchronous dispatch: schedules with a small stagger (300ms)
    // so client receives the 202 Accepted response and can establish SSE / polling before pipeline steps execute
    setTimeout(async () => {
      try {
        logger.info({ tenantId, poId, jobId }, "Async Queue: Starting PO processing workflow");
        await POProcessingWorkflow.runWorkflow(tenantId, poId);
      } catch (e: any) {
        logger.error({ e: e.message, tenantId, poId }, "Async PO processing error");
      }
    }, 300);

    return jobId;
  }
}
