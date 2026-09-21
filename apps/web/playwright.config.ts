import { defineConfig, devices } from "@playwright/test";

/**
 * E2E (docs/TESTING_STRATEGY.md): tres flujos contra Postgres local (Docker o el servicio de CI)
 * con el worker en modo demo. Local: reutiliza `next dev` si ya está corriendo en :3000.
 * CI: levanta `next start` (build previo) con DB_TARGET=local.
 */
const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [["github"], ["list"]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    viewport: { width: 390, height: 844 }, // mobile-first: se prueba en el ancho del celular
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: isCi ? "pnpm start" : "pnpm dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !isCi,
    timeout: 120_000,
    // LLM_DEMO: la evaluación inmediata al pegar JD (JS-027) usa el LLM falso, nunca uno real.
    // Ojo local: con un `next dev` ya levantado se reusa ese server y su env (sin LLM_DEMO).
    env: { DB_TARGET: "local", LLM_DEMO: "1" },
  },
});
