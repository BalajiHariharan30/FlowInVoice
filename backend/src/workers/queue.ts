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
      this.redisConnection = new Redis({
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        connectTimeout: 2000
      });

      this.redisConnection.on("error", (err) => {
        if (!this.isMock) {
          logger.warn("Redis connection failed. Switching to local in-memory async runner");
          this.isMock = true;
        }
      });

      // Try pinging Redis
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

      logger.info("BullMQ queues & workers initialized");
    } catch (err) {
      logger.warn("Operating with in-process asynchronous queue runner");
      this.isMock = true;
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

    // In-process async execution (dev/test fallback)
    setImmediate(async () => {
      try {
        await POProcessingWorkflow.runWorkflow(tenantId, poId);
      } catch (e) {
        logger.error({ e, tenantId, poId }, "Async PO processing error");
      }
    });

    return jobId;
  }
}
