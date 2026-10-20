import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke post-deploy (docs/OPERACION.md): solo lectura contra producción, sin servidor propio ni
 * base. Corre desde .github/workflows/smoke.yml después de cada deploy a Production.
 */
const BASE_URL = process.env.SMOKE_BASE_URL;
if (!BASE_URL) {
  throw new Error(
    "Falta SMOKE_BASE_URL (ej. https://busquedalaboral.malejo.com.ar) para el smoke.",
  );
}

export default defineConfig({
  testDir: "./e2e-smoke",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: BASE_URL,
    // Solo en el reintento; el workflow no sube trazas (podrían mostrar datos de la cuenta de prueba)
    trace: "on-first-retry",
    viewport: { width: 390, height: 844 },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
