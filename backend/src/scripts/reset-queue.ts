import { Queue } from "bullmq";
import dotenv from "dotenv";

dotenv.config();

function getConnectionOptions() {
  if (process.env.REDIS_URL && process.env.REDIS_URL.trim().length > 0) {
    const parsed = new URL(process.env.REDIS_URL.trim());
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      tls: parsed.protocol === "rediss:" ? {} : undefined,
      maxRetriesPerRequest: null
    };
  }

  return {
    host: process.env.REDIS_HOST || "localhost",
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  };
}

const queue = new Queue("po-processing", {
  connection: getConnectionOptions()
});

queue.on("error", () => {
  // Prevent unhandled error event if redis connection fails
});

export async function resetQueue() {
  console.log("Clearing BullMQ queues...");
  try {
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
    await queue.clean(0, 1000, "delayed");
    await queue.clean(0, 1000, "active");
    await queue.clean(0, 1000, "wait" as any);
    console.log("✅ BullMQ Redis queue purged successfully.");
  } finally {
    await queue.close();
  }
}

const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("reset-queue.ts") || process.argv[1].endsWith("reset-queue.js"));

if (isDirectExecution) {
  resetQueue()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Error clearing queue:", err);
      process.exit(1);
    });
}
