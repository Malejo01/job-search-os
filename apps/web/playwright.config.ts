import { defineConfig, devices } from "@playwright/test";

/**
 * E2E (docs/TESTING_STRATEGY.md): flujos contra Postgres local (Docker o el servicio de CI)
 * con el LLM en modo demo. Local: `next dev`; CI: `next start` (build previo). DB_TARGET=local.
 *
 * Servidor propio en :3100, nunca reusado: la evaluación inmediata al pegar JD (JS-027) llama
 * al LLM desde la app, y un `next dev` ya levantado en :3000 (el de uso diario) tiene el modelo
 * real. El 2026-09-21 los e2e reusaron ese server y gastaron dos llamadas reales a Gemini.
 * Con puerto propio y LLM_DEMO=1 fijo, un e2e no puede llamar a un modelo pago.
 */
const isCi = Boolean(process.env.CI);
const PORT = 3100;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCi ? 1 : 0,
  reporter: isCi ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
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
    command: isCi ? `pnpm start --port ${PORT}` : `pnpm dev --port ${PORT}`,
    url: `${BASE_URL}/api/health`,
    // Nunca reusar: si el puerto está ocupado, falla en vez de correr contra un server con LLM real
    reuseExistingServer: false,
    timeout: 120_000,
    // AUTH_URL: el login redirige a este puerto aunque .env.local apunte a :3000
    env: { DB_TARGET: "local", LLM_DEMO: "1", AUTH_URL: BASE_URL },
  },
});
