import { defineConfig } from "vitest/config";

/** Solo para las herramientas manuales de la C-26 (`pnpm --filter @job-search-os/evals exec vitest run --config src/tools/vitest.tool.config.ts`). No corre en `pnpm test`. */
export default defineConfig({
  test: {
    include: ["src/tools/*.tool.ts"],
    testTimeout: 60_000,
  },
});
