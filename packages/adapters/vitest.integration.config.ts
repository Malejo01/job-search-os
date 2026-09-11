import { defineConfig } from "vitest/config";

/** Integración: Postgres real (DATABASE_URL en CI o Testcontainers local). */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
