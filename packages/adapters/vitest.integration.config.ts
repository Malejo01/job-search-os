import { defineConfig } from "vitest/config";

/** Integración: Postgres real (DATABASE_URL en CI o Testcontainers local). */
export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // Guarda JS-121: valida las URL de entorno antes de conectar (el setup vive en packages/db)
    setupFiles: ["../db/src/test-setup.integration.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
