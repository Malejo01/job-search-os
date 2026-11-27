import { join } from "node:path";
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
// R4-15: el server corre el asistente en modo «testers» (admins + ASSISTANT_TESTER_EMAILS). El runner
// lo sabe por esta variable (los workers heredan el entorno), así el spec 123 se saltea sin ella.
const ASSISTANT_MODE = "testers";
process.env.E2E_ASSISTANT_MODE = ASSISTANT_MODE;
// R20-04: el runner sabe que el server corre con CV_TAILOR=testers (e2e 156)
process.env.E2E_CV_TAILOR_MODE = "testers";
// R25: el runner sabe que el server corre con VOICE_SERVER_TRANSCRIBE=testers (e2e 220-229)
process.env.E2E_VOICE_SERVER_MODE = "testers";
// R31: el runner sabe que el server corre con JOB_CARD=testers (ficha del aviso, e2e 370-387)
process.env.E2E_JOB_CARD_MODE = "testers";
// R32-09: email de novedades para testers con el adaptador simulado; el runner firma la baja con el mismo valor
// (de prueba, solo e2e: no es un secreto)
const NEWS_EMAIL_SECRET_E2E = "e2e-novedades-valor-de-prueba";
process.env.E2E_NEWS_EMAIL_MODE = "testers";
process.env.NEWS_EMAIL_SECRET = NEWS_EMAIL_SECRET_E2E;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
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
    // Asistente (AG-3): encendido para admins con el modelo simulado; cupo alto para las corridas.
    // CV_CHAT_ENABLED=all: el chat de CV (86) está abierto a cualquier sesión, como en la beta (C2-1)
    // START_HERE_ENABLED=1: «Empezá acá» en /hoy (C8-5, e2e 107), apagado por defecto en Vercel
    env: {
      DB_TARGET: "local",
      LLM_DEMO: "1",
      AUTH_URL: BASE_URL,
      ASSISTANT_ENABLED: ASSISTANT_MODE,
      // La persona B de los e2e de dos usuarios (helpers.ts: E2E_B_EMAIL) es la de prueba; la segunda es la
      // persona nueva del recorrido del agente de perfil (e2e 135, ADR-034), que es tester solo ahí
      ASSISTANT_TESTER_EMAILS: "usuario-b@dos.test,agente-perfil-135@onboarding.test",
      ASSISTANT_MONTHLY_CONVERSATIONS: "500",
      CV_CHAT_ENABLED: "all",
      // ADR-034 (R11-1): el agente de perfil desde el CV, en la etapa `testers` (admins y ASSISTANT_TESTER_EMAILS).
      // Quien no está en la lista no lo ve (e2e 134); el recorrido completo, con el modelo en demo, es el 135
      CV_IMPORT_ENABLED: "1",
      CV_PROFILE_AGENT: "testers",
      // ADR-038 (R12-10): el coach de CV, también en `testers` (exige el agente de perfil). Flujo 147
      CV_COACH: "testers",
      // R20-04: versión del CV adaptada con IA (modelo simulado por LLM_DEMO=1). Flujo 156
      CV_TAILOR: "testers",
      // R25: voz transcripta en el servidor para testers (la persona B), modelo simulado por LLM_DEMO=1. Flujos 220-229
      VOICE_SERVER_TRANSCRIBE: "testers",
      // R31: ficha del aviso para testers (admins y ASSISTANT_TESTER_EMAILS), modelo simulado. Flujos 370-387
      JOB_CARD: "testers",
      // R32-09: email de novedades (flujo 397)
      NEWS_EMAIL: "testers",
      NEWS_EMAIL_SECRET: NEWS_EMAIL_SECRET_E2E,
      // R26-01: fichas de prueba de Academy (todas en borrador), en vez de las del repo. Solo vale con
      // DB_TARGET=local (lib/academy.ts). Flujos 230-234
      ACADEMY_DIR: join(__dirname, "e2e", "fixtures", "academy"),
      START_HERE_ENABLED: "1",
      // C8-6: «¿Qué es esto?» en las 5 pantallas (e2e 108), apagado por defecto en Vercel
      HELP_TIPS_ENABLED: "1",
      // C8-17: triage del feedback (e2e 111), apagado por defecto en Vercel
      FEEDBACK_TRIAGE_ENABLED: "1",
      // MCP-1: tokens personales del MCP (e2e 124). El conector compartido (MCP_TOKEN, del job de CI)
      // opera sobre la persona B de los e2e de dos usuarios, para comprobar que no se mezcla con A.
      MCP_USER_TOKENS: "testers",
      MCP_USER_ID: "b0000000-0000-4000-8000-000000000002",
    },
  },
});
