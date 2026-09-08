import mongoose from "mongoose";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

export async function connectDatabase(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState >= 1) {
    return mongoose;
  }

  try {
    const conn = await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
    logger.info("Connected to MongoDB successfully");
    return conn;
  } catch (error) {
    logger.error({ error }, "Failed to connect to MongoDB");
    if (env.NODE_ENV === "test") {
      logger.warn("Test environment continuing with memory mock mode if configured");
    }
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info("Disconnected from MongoDB");
  }
}
