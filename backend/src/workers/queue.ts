import { Queue, Worker, Job } from "bullmq";
import Redis, { RedisOptions } from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { runOrchestrationWorkflow } from "../ai/workflow/index.js";
import { PurchaseOrderRepository, ReviewRepository } from "../repositories/index.js";
import { PurchaseOrderModel } from "../models/purchase-order.model.js";
import { PurchaseOrderEntity, mapToEntityStatus } from "../domain/entities/purchase-order.entity.js";
import { runDeterministicPipeline } from "../ai/workflow/deterministic.js";

export interface POProcessingJobData {
  tenantId: string;
  poId: string;
  attempt?: number;
}

export interface POResumeJobData {
  tenantId: string;
  poId: string;
  approvedReviewId: string;
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
    return delay;
  };

  if (isUrlConfigured && rawUrl) {
    return {
      url: rawUrl,
      options: {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy,
        lazyConnect: true,
        connectTimeout: 5000
      }
    };
  }

  return {
    options: {
      host: env.REDIS_HOST || "localhost",
      port: env.REDIS_PORT || 6379,
      password: env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy,
      lazyConnect: true,
      connectTimeout: 5000
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
  private static poQueue: Queue | null = null;
  private static poWorker: Worker | null = null;
  private static queueConnection: Redis | null = null;
  private static workerConnection: Redis | null = null;
  private static isMock: boolean = true;
  private static isConnecting: boolean = false;
  private static reconnectTimer: NodeJS.Timeout | null = null;
  private static lastError: string | null = null;
  private static connectAttempts: number = 0;
  private static activeResumeJobs: Set<string> = new Set<string>();
  private static activeProcessingJobs: Set<string> = new Set<string>();

  static async initialize(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    this.connectAttempts++;

    const maxStartupAttempts = 2;
    let lastErr: any = null;

    for (let attempt = 1; attempt <= maxStartupAttempts; attempt++) {
      try {
        await this.closeConnections();

        this.queueConnection = createRedisClient();
        this.workerConnection = createRedisClient();

        this.queueConnection.on("error", (err) => {
          if (!err.message?.includes("ECONNREFUSED") && !err.message?.includes("ENOTFOUND")) {
            logger.warn({ err: err.message }, "BullMQ Queue Redis connection warning");
          }
        });

        this.workerConnection.on("error", (err) => {
          if (!err.message?.includes("ECONNREFUSED") && !err.message?.includes("ENOTFOUND")) {
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
            removeOnComplete: true,
            removeOnFail: 100
          }
        });

        // Initialize Worker with dedicated connection
        this.poWorker = new Worker(
          "po-processing",
          async (job: Job<POProcessingJobData | POResumeJobData>) => {
            // 1. ALWAYS extract only the ID from job data (never full stale objects)
            const isResumeAction = job.name === "resume-po";
            const poId = (job.data as any).poId;
            const tenantId = (job.data as any).tenantId;
            const approvedReviewId = (job.data as any).approvedReviewId;

            // 2. Fetch fresh state directly from DB
            const po = await PurchaseOrderRepository.findById(tenantId, poId);
            if (!po || ["REJECTED", "DELETED", "COMPLETED"].includes(po.status)) {
              logger.info({ poId, status: po?.status }, "BullMQ worker: Skipping execution for non-processable/terminal PO");
              return;
            }

            // 3. Map MongoDB Document -> Domain Entity State Machine
            const poEntity = PurchaseOrderEntity.create({
              id: po._id.toString(),
              tenantId: po.tenantId,
              status: mapToEntityStatus(po.status),
              vendorName: po.customerName,
              totalAmount: po.totalAmount,
              baseAmount: po.subtotal,
              taxAmount: po.tax,
              lineItems: (po.lineItems || []).map((li: any) => ({
                description: li.description || li.productCode || "",
                quantity: li.quantity || 1,
                unitPrice: li.unitPrice || 0,
                totalPrice: li.lineTotal || 0
              })),
              isResumed: Boolean(isResumeAction || approvedReviewId),
              version: po.version || 0
            });

            if (isResumeAction || approvedReviewId) {
              if (poEntity.status !== "DISCREPANCY_FOUND" && poEntity.status !== "READY_FOR_APPROVAL") {
                poEntity.markReadyForApproval();
              }
              poEntity.resumeExecution();
            }

            // 4. Run pipeline using guarded aggregate root
            if (isResumeAction) {
              logger.info({ jobId: job.id, poId }, "Processing PO resume job via live BullMQ worker");
              const { runOrchestrationWorkflow } = await import("../ai/workflow/graph.js");
              await runOrchestrationWorkflow(tenantId, poId, undefined, approvedReviewId);
            } else {
              logger.info({ jobId: job.id, poId }, "Processing PO job via live BullMQ worker");
              const { runOrchestrationWorkflow } = await import("../ai/workflow/graph.js");
              await runOrchestrationWorkflow(tenantId, poId);
            }

            logger.info({ poId, status: poEntity.status }, `[Worker] Successfully processed PO ${poId}`);
          },
          { connection: this.workerConnection }
        );
        poWorker = this.poWorker;

        // After all BullMQ retry attempts are exhausted for a resume job,
        // reopen a review ticket instead of letting it disappear silently.
        this.poWorker.on("failed", async (job, err) => {
          if (!job) return;
          const attemptsLimit = job.opts.attempts || 1;
          if (job.name === "resume-po" && job.attemptsMade >= attemptsLimit) {
            const data = job.data as POResumeJobData;
            const { handleResumeExhausted } = await import("../ai/workflow/resume-failure-handler.js");
            await handleResumeExhausted(data.tenantId, data.poId, data.approvedReviewId, err as Error);
          }
        });

        this.isMock = false;
        this.lastError = null;
        this.isConnecting = false;
        this.startSlaWatcher();
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
    this.startSlaWatcher();

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

  private static slaInterval: NodeJS.Timeout | null = null;

  private static startSlaWatcher(): void {
    if (this.slaInterval) return;
    this.slaInterval = setInterval(async () => {
      try {
        await ReviewRepository.escalateStaleReviews(undefined, 24);
      } catch (err: any) {
        logger.warn({ err: err.message }, "Background SLA escalation check encountered an error");
      }
    }, 300000); // Check every 5 minutes
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
    const jobId = `po-process-${tenantId}-${poId}`;

    if (!this.isMock && this.poQueue) {
      try {
        await this.poQueue.add(
          "process-po",
          { tenantId, poId, attempt: 1 },
          {
            jobId,
            removeOnComplete: true,
            removeOnFail: 100
          }
        );
        logger.info({ jobId, queue: "po-processing" }, "Successfully enqueued PO job to BullMQ");
        return jobId;
      } catch (err: any) {
        logger.warn({ err: err.message, jobId }, "BullMQ enqueue failed, executing with asynchronous runner");
      }
    }

    if (this.activeProcessingJobs.has(jobId)) {
      logger.info({ jobId }, "Async Queue: Processing job is already active, merging duplicate execution");
      return jobId;
    }
    this.activeProcessingJobs.add(jobId);

    // Realistic asynchronous dispatch: schedules with a small stagger (300ms)
    // so client receives the 202 Accepted response and can establish SSE / polling before pipeline steps execute
    setTimeout(async () => {
      try {
        logger.info({ tenantId, poId, jobId }, "Async Queue: Starting PO processing workflow");
        const po = await PurchaseOrderRepository.findById(tenantId, poId);
        if (!po || ["REJECTED", "DELETED", "COMPLETED"].includes(po.status)) {
          logger.info({ poId, status: po?.status }, "Async Queue: Skipping execution for non-processable PO");
          return;
        }
        await runOrchestrationWorkflow(tenantId, poId);
      } catch (e: any) {
        logger.error({ e: e.message, tenantId, poId }, "Async PO processing error");
      } finally {
        this.activeProcessingJobs.delete(jobId);
      }
    }, 300);

    return jobId;
  }

  /**
   * Enqueues the post-approval pipeline resume. Never runs inline on the
   * HTTP request — this is the fix for the approve-endpoint crash. With
   * BullMQ available, retries (3 attempts, exponential backoff) are handled
   * by BullMQ itself and survive a process crash since state lives in Redis.
   * Without Redis, we retry in-process ourselves so the same safety net
   * still applies, just without crash-survival.
   */
  static async addPOResumeJob(tenantId: string, poId: string, approvedReviewId: string): Promise<string> {
    const jobId = `po-resume-${tenantId}-${poId}-${approvedReviewId}`;

    if (!this.isMock && this.poQueue) {
      try {
        await this.poQueue.add(
          "resume-po",
          { tenantId, poId, approvedReviewId },
          {
            jobId,
            removeOnComplete: true,
            removeOnFail: 100
          }
        );
        logger.info({ jobId, queue: "po-processing" }, "Successfully enqueued PO resume job to BullMQ");
        return jobId;
      } catch (err: any) {
        logger.warn({ err: err.message, jobId }, "BullMQ resume enqueue failed, executing with asynchronous runner");
      }
    }

    if (this.activeResumeJobs.has(jobId)) {
      logger.info({ jobId }, "Async Queue: Resume job is already active, merging duplicate execution");
      return jobId;
    }
    this.activeResumeJobs.add(jobId);

    const MAX_ATTEMPTS = 3;
    const runWithRetry = async (attempt: number): Promise<void> => {
      try {
        const po = await PurchaseOrderRepository.findById(tenantId, poId);
        if (!po || ["REJECTED", "DELETED", "COMPLETED"].includes(po.status)) {
          logger.info({ poId, status: po?.status }, "Async Queue: Skipping resume execution for terminal PO");
          this.activeResumeJobs.delete(jobId);
          return;
        }

        const { runOrchestrationWorkflow } = await import("../ai/workflow/graph.js");
        logger.info({ tenantId, poId, jobId, attempt }, "Async Queue: Starting PO resume workflow");
        await runOrchestrationWorkflow(tenantId, poId, undefined, approvedReviewId);
        this.activeResumeJobs.delete(jobId);
      } catch (e: any) {
        logger.error({ e: e.message, tenantId, poId, attempt }, "Async PO resume error");

        const isPermanentError =
          e?.code === "DUPLICATE_PO_NUMBER" ||
          e?.message?.includes("PO not found") ||
          e?.message?.includes("invalid schema");

        if (isPermanentError || attempt >= MAX_ATTEMPTS) {
          this.activeResumeJobs.delete(jobId);
          const { handleResumeExhausted } = await import("../ai/workflow/resume-failure-handler.js");
          await handleResumeExhausted(tenantId, poId, approvedReviewId, e);
        } else {
          setTimeout(() => runWithRetry(attempt + 1), Math.pow(2, attempt) * 1000);
        }
      }
    };
    setTimeout(() => runWithRetry(1), 300);

    return jobId;
  }
}

export let poWorker: Worker | null = null;

/**
 * Direct DDD Worker function (InvoiceScan pattern) to process a job with PurchaseOrderEntity encapsulation.
 */
export async function processPOJobWithEntity(job: Job): Promise<void> {
  const { poId, tenantId, isResumeAction, approvedReviewId } = (job.data as any) || {};
  const tId = tenantId || "default";
  const poDoc = await PurchaseOrderRepository.findById(tId, poId);
  if (!poDoc) {
    throw new Error(`PO with ID ${poId} not found in database.`);
  }

  const poEntity = PurchaseOrderEntity.create({
    id: poDoc._id.toString(),
    tenantId: poDoc.tenantId,
    status: mapToEntityStatus(poDoc.status),
    vendorName: poDoc.customerName,
    totalAmount: poDoc.totalAmount,
    baseAmount: poDoc.subtotal,
    taxAmount: poDoc.tax,
    lineItems: (poDoc.lineItems || []).map((li: any) => ({
      description: li.description || li.productCode || "",
      quantity: li.quantity || 1,
      unitPrice: li.unitPrice || 0,
      totalPrice: li.lineTotal || 0
    })),
    isResumed: Boolean(isResumeAction || approvedReviewId),
    version: poDoc.version || 0
  });

  if (isResumeAction || approvedReviewId) {
    if (poEntity.status !== "DISCREPANCY_FOUND" && poEntity.status !== "READY_FOR_APPROVAL") {
      poEntity.markReadyForApproval();
    }
    poEntity.resumeExecution();
  }

  const updatedEntity = await runDeterministicPipeline(poEntity);
  logger.info({ poId, status: updatedEntity.status }, `[Worker] Successfully processed PO ${poId} -> Final Status: ${updatedEntity.status}`);
}
