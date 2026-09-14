import { Queue } from "bullmq";
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "backend/.env") });

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

async function resetQueue() {
  console.log("Purging stuck BullMQ jobs...");
  try {
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
    await queue.clean(0, 1000, "active");
    await queue.clean(0, 1000, "delayed");
    console.log("✅ BullMQ queue purged.");
  } finally {
    await queue.close();
  }
  process.exit(0);
}

resetQueue().catch((err) => {
  console.error("Queue clear error:", err);
  process.exit(1);
});
