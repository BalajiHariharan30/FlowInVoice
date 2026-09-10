import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PREFIX: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  JWT_SECRET: z.string().default("super-secret-jwt-key-minimum-32-chars-length"),
  JWT_EXPIRES_IN: z.string().default("24h"),
  REFRESH_TOKEN_SECRET: z.string().default("super-secret-refresh-key-minimum-32-chars-length"),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("30d"),
  GOOGLE_CLIENT_ID: z.string().optional().default("mock-google-client-id"),
  GOOGLE_CLIENT_SECRET: z.string().optional().default("mock-google-client-secret"),

  MONGODB_URI: z.string().default("mongodb://127.0.0.1:27017/p2i_saas"),

  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(""),
  REDIS_URL: z.string().optional(),
  REQUIRE_REDIS: z.coerce.boolean().default(false),

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
  STORAGE_PROVIDER: z.enum(["s3", "mock"]).default("s3"),

  MODEL_ARN: z
    .string()
    .optional()
    .default(
      process.env.MODEL_ARN ||
        process.env.BEDROCK_MODEL_ARN ||
        "arn:aws:bedrock:us-east-1:325999881191:inference-profile/us.meta.llama3-1-70b-instruct-v1:0"
    ),
  BEDROCK_MODEL_ARN: z
    .string()
    .optional()
    .default(
      process.env.BEDROCK_MODEL_ARN ||
        process.env.MODEL_ARN ||
        "arn:aws:bedrock:us-east-1:325999881191:inference-profile/us.meta.llama3-1-70b-instruct-v1:0"
    ),

  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional().default(""),
  VECTOR_PROVIDER: z.enum(["qdrant", "mock"]).default("qdrant"),

  LLM_PROVIDER: z.enum(["bedrock", "mistral", "groq", "openrouter", "mock"]).default("bedrock"),
  MISTRAL_API_KEY: z.string().optional().default(""),
  GROQ_API_KEY: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  GEMINI_API_KEY: z.string().optional().default(""),

  DOCUMENT_AI_PROVIDER: z.enum(["bedrock", "mistral_ocr", "vision_fallback", "mock"]).default("bedrock")
});


export type EnvConfig = z.infer<typeof envSchema>;

let parsedEnv: EnvConfig;
try {
  parsedEnv = envSchema.parse(process.env);
} catch (err: any) {
  console.error("Invalid environment variables:", err);
  process.exit(1);
}

export const env: EnvConfig = parsedEnv;
