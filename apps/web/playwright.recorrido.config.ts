import { defineConfig, devices } from "@playwright/test";

/**
 * Recorrido por carreras (T-1): config propia, aparte de `playwright.config.ts` (la del CI, con testDir
 * `./e2e`), así que el CI nunca lo corre. No levanta servidor: apunta a la URL que se le pasa a
 * `pnpm recorrido <url>` (la lleva `recorrido/run.mjs` en RECORRIDO_URL). Sin reintentos: cada corrida
 * puede generar evaluaciones reales (gasto de LLM) en la base a la que apunta.
 */
const BASE_URL = process.env.RECORRIDO_URL;
if (!BASE_URL) {
  throw new Error("falta la URL: pnpm recorrido <url> (por ejemplo http://localhost:3000)");
}

export default defineConfig({
  testDir: "./recorrido",
  timeout: 30 * 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    // Sin trazas ni video: mostrarían datos de las cuentas de prueba
    trace: "off",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
