import { z } from "zod";

const envSchema = z.object({
  VITE_API_BASE_URL: z.string().default("http://localhost:4000/api/v1"),
  VITE_GOOGLE_CLIENT_ID: z.string().default("mock-google-client-id")
});

const parsed = envSchema.safeParse({
  VITE_API_BASE_URL: (import.meta as any).env?.VITE_API_BASE_URL,
  VITE_GOOGLE_CLIENT_ID: (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID
});

if (!parsed.success) {
  console.error("Invalid frontend environment configuration:", parsed.error.format());
}

export const env = parsed.success
  ? parsed.data
  : {
      VITE_API_BASE_URL: "http://localhost:4000/api/v1",
      VITE_GOOGLE_CLIENT_ID: "mock-google-client-id"
    };
