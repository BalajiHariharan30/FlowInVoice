import { Queue, Worker, Job } from "bullmq";
import Redis from "ioredis";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { POProcessingWorkflow } from "../agents/workflow.js";

export interface POProcessingJobData {
  tenantId: string;
  poId: string;
  attempt?: number;
}

export class QueueManager {
  private static redisConnection: Redis | null = null;
  private static poQueue: Queue | null = null;
  private static poWorker: Worker | null = null;
  private static isMock = false;

  static async initialize(): Promise<void> {
    try {
      const redisOpts = env.REDIS_URL
        ? env.REDIS_URL
        : {
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD || undefined,
            maxRetriesPerRequest: null,
            connectTimeout: 2000,
            enableOfflineQueue: false,
            retryStrategy: () => null,
            lazyConnect: true
          };

      this.redisConnection = new Redis(redisOpts as any);

      this.redisConnection.on("error", (err) => {
        if (!this.isMock) {
          logger.warn({ err: err.message }, "Redis connection warning");
        }
      });

      // Try connecting and pinging Redis
      await this.redisConnection.connect();
      await this.redisConnection.ping();

      this.poQueue = new Queue("po-processing", {
        connection: this.redisConnection,
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: true
        }
      });

      this.poWorker = new Worker(
        "po-processing",
        async (job: Job<POProcessingJobData>) => {
          logger.info({ jobId: job.id, data: job.data }, "Processing PO job via BullMQ");
          await POProcessingWorkflow.runWorkflow(job.data.tenantId, job.data.poId);
        },
        { connection: this.redisConnection }
      );

      this.isMock = false;
      logger.info("BullMQ queues & workers initialized with live Redis connection");
    } catch (err: any) {
      if (this.redisConnection) {
        try {
          this.redisConnection.disconnect();
        } catch (_) {}
        this.redisConnection = null;
      }
      this.isMock = true;

      if (env.REQUIRE_REDIS) {
        throw new Error(`REQUIRE_REDIS is set to true, but Redis connection failed: ${err.message}`);
      }

      logger.warn(
        { error: err.message },
        "Redis unavailable — operating with asynchronous queue runner (non-blocking)"
      );
    }
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
        return jobId;
      } catch (err) {
        logger.warn({ err }, "BullMQ enqueue failed, executing asynchronously");
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
