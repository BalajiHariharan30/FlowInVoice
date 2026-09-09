import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PREFIX: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  JWT_SECRET: z.string().default("super-secret-jwt-key-minimum-32-chars-length"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_SECRET: z.string().default("super-secret-refresh-key-minimum-32-chars-length"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("7d"),
  GOOGLE_CLIENT_ID: z.string().optional().default("mock-google-client-id"),
  GOOGLE_CLIENT_SECRET: z.string().optional().default("mock-google-client-secret"),

  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/p2i_saas"),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),

  AWS_REGION: z.string().default(process.env.AWS_REGION || "us-east-1"),
  AWS_ACCESS_KEY_ID: z
    .string()
    .default(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY || "mock-access-key"),
  AWS_SECRET_ACCESS_KEY: z
    .string()
    .default(process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_KEY || "mock-secret-key"),
  AWS_S3_BUCKET_NAME: z
    .string()
    .default(process.env.AWS_S3_BUCKET_NAME || process.env.S3_BUCKET_NAME || "p2i-documents-bucket"),
  STORAGE_PROVIDER: z.enum(["s3", "mock"]).default("mock"),

  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional().default(""),
  VECTOR_PROVIDER: z.enum(["qdrant", "mock"]).default("mock"),

  LLM_PROVIDER: z.enum(["mistral", "groq", "openrouter", "mock"]).default("mock"),
  MISTRAL_API_KEY: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),

  DOCUMENT_AI_PROVIDER: z.enum(["mistral_ocr", "vision_fallback", "mock"]).default("mock")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
