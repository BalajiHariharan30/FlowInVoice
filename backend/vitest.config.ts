import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    env: {
      DOCUMENT_AI_PROVIDER: "mock",
      STORAGE_PROVIDER: "mock",
      VECTOR_PROVIDER: "mock",
      LLM_PROVIDER: "mock"
    }
  }
});
