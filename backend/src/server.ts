import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { connectDatabase } from "./config/database.js";
import { QdrantService } from "./rag/qdrant.service.js";
import { QueueManager } from "./workers/queue.js";
import { isDbConnected } from "./repositories/base.js";

// Safety net: log unhandled promise rejections without crashing the server
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "Unhandled promise rejection — continuing");
});

// Safety net: log uncaught exceptions without crashing the server
process.on("uncaughtException", (err: Error) => {
  logger.error({ err }, "Uncaught exception — continuing");
});

async function bootstrap() {
  try {
    // 1. Connect MongoDB
    try {
      await connectDatabase();
    } catch (dbErr) {
      logger.warn("Continuing with in-memory or fallback database mode for local dev/testing");
    }

    // 2. Initialize Qdrant collection
    await QdrantService.initialize();

    // 3. Initialize BullMQ queue & worker
    try {
      await QueueManager.initialize();
    } catch (queueErr: any) {
      if (env.REQUIRE_REDIS) {
        throw queueErr;
      }
      logger.warn({ err: queueErr.message }, "Queue initialization fallback active");
    }

    // 4. Start HTTP Server
    const app = createApp();
    app.listen(env.PORT, () => {
      logger.info(`PO-to-Invoice Backend listening on port ${env.PORT}`);
      logger.info(`OpenAPI spec available at http://localhost:${env.PORT}/api/docs/openapi.json`);
      logger.info({
        DOCUMENT_AI_PROVIDER: env.DOCUMENT_AI_PROVIDER,
        STORAGE_PROVIDER: env.STORAGE_PROVIDER,
        VECTOR_PROVIDER: env.VECTOR_PROVIDER,
        LLM_PROVIDER: env.LLM_PROVIDER,
        ERP_PROVIDER: process.env.ERP_PROVIDER || "sandbox",
        DATABASE: isDbConnected() ? "MongoDB Atlas (Live)" : "In-Memory Fallback"
      }, "=== Active Production System Providers ===");
    });
  } catch (error: any) {
    logger.error({ err: error, message: error?.message, stack: error?.stack }, "Failed to start server");
    process.exit(1);
  }
}

bootstrap();

