import { z } from "zod";

const isBrowser = typeof window !== "undefined";
const isLocal = isBrowser && (
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
);

const rawEnvApiUrl = (import.meta as any).env?.VITE_API_BASE_URL;

const defaultApiBaseUrl = rawEnvApiUrl && rawEnvApiUrl.trim().length > 0
  ? rawEnvApiUrl
  : (isLocal ? "http://localhost:4000/api/v1" : "/api/v1");

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().default(defaultApiBaseUrl),
  VITE_GOOGLE_CLIENT_ID: z.string().default("mock-google-client-id")
});

const parsed = envSchema.safeParse({
  VITE_API_BASE_URL: defaultApiBaseUrl,
  VITE_GOOGLE_CLIENT_ID: (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID
});

if (!parsed.success) {
  console.error("Invalid frontend environment configuration:", parsed.error.format());
}

export const env = parsed.success
  ? parsed.data
  : {
      VITE_API_BASE_URL: defaultApiBaseUrl,
      VITE_GOOGLE_CLIENT_ID: "mock-google-client-id"
    };
