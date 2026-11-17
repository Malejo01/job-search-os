import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test } from "@playwright/test";
import { and, eq, like } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 141 (R12-6, D6 de ADR-038): la puerta única de `/cv`. El servidor de los e2e corre con
 * `CV_PROFILE_AGENT=testers` y `CV_CHAT_ENABLED=all` (playwright.config.ts).
 * - Con el agente (la persona seed es admin, así que es tester): «¿Ya tenés un CV hecho?» con «Tengo CV»
 *   (lectura, `/cv/perfil`) y «No tengo CV» (chat, `/cv/armar`); el link suelto del chat ya no está.
 * - Sin el agente (una persona que no es tester): `/cv` queda como antes, sin puerta y con «Armá tu CV con IA».
 * Persona sin agente inventada, creada como dueño con el onboarding completo y borrada al final.
 */
test.describe.configure({ mode: "serial" });

const C_ID = "c0000000-0000-4000-8000-000000000141";
const C_EMAIL = "puerta-cv-sin-agente@dos.test";
const C_PASSWORD = "dev-password-c-local";

async function ensureNonTester(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: C_ID,
        email: C_EMAIL,
        name: "Persona C",
        passwordHash: hashPassword(C_PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: C_ID,
        displayName: "Persona C",
        locationCountry: "AR",
        inboundAddress: "u_puerta_c@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona C para el e2e de la puerta de Tu CV. No corresponde a nadie real.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, C_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: C_ID, version: 1, active: true, rules: {} as never });
    }
  } finally {
    await close();
  }
}

async function removeNonTester(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.llmCalls).where(eq(s.llmCalls.userId, C_ID));
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, C_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, C_ID));
    await db.delete(s.users).where(eq(s.users.id, C_ID));
  } finally {
    await close();
  }
}

/** Las charlas de CV que abre este spec cuentan en el tope diario de la persona seed: se borran. */
async function cleanSeedChats(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_USER_ID), like(s.llmCalls.label, "cv:%")));
  } finally {
    await close();
  }
}

test.describe("Flujo 141: puerta «Tengo CV» / «No tengo CV» en Tu CV", () => {
  test.beforeAll(cleanSeedChats);
  test.afterAll(async () => {
    await cleanSeedChats();
    await removeNonTester();
  });

  test("con el agente de perfil: la puerta lleva a la lectura y al chat", async ({ page }) => {
    await login(page);
    await page.goto("/cv");
    const door = page.getByTestId("cv-door");
    await expect(door.getByRole("heading", { name: "¿Ya tenés un CV hecho?" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Armá tu CV con IA", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("profile-agent-entry")).toHaveCount(0);

    await door.getByRole("link", { name: "Tengo CV", exact: true }).click();
    await page.waitForURL(/\/cv\/perfil$/);

    await page.goto("/cv");
    await page
      .getByTestId("cv-door")
      .getByRole("link", { name: "No tengo CV", exact: true })
      .click();
    await page.waitForURL(/\/cv\/armar$/);
    await expect(page.getByRole("button", { name: "Empezar" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("no lo pegues acá");
  });

  test("sin el agente de perfil: /cv queda como antes", async ({ browser, baseURL }) => {
    await ensureNonTester();
    const context = await browser.newContext({ baseURL });
    try {
      const page = await context.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(C_EMAIL);
      await page.getByLabel("Contraseña").fill(C_PASSWORD);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL(/\/hoy/);
      await page.goto("/cv");
      await expect(page.getByRole("heading", { name: "Tu CV", level: 1 })).toBeVisible();
      await expect(page.getByTestId("cv-door")).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Armá tu CV con IA", exact: true }),
      ).toBeVisible();
      // Un CV pegado en el chat sigue derivando a la carga a mano
      const r = await page.request.post("/api/cv-chat", {
        data: { action: "start" },
        headers: { Origin: baseURL ?? "" },
      });
      expect(r.status()).toBe(200);
      const start = (await r.json()) as { ticket: string; state: unknown };
      const pasted = await page.request.post("/api/cv-chat", {
        data: { action: "turn", ticket: start.ticket, state: start.state, message: PASTED_CV },
        headers: { Origin: baseURL ?? "" },
      });
      expect(pasted.status()).toBe(422);
      expect(await pasted.json()).toMatchObject({
        ok: false,
        error: "pasted_cv",
        href: "/settings/historial",
      });
    } finally {
      await context.close();
    }
  });

  test("con el agente, un CV pegado en el chat lleva a la lectura de CV", async ({ page }) => {
    await login(page);
    await page.goto("/cv/armar");
    await page.getByRole("button", { name: "Empezar" }).click();
    const answer = page.getByLabel("Tu respuesta");
    await answer.fill(PASTED_CV);
    await page.getByRole("button", { name: "Enviar", exact: true }).click();
    const alert = page.locator("main").getByRole("alert");
    await expect(alert).toContainText("pegaste un CV entero");
    await expect(alert).toContainText("lectura de CV");
    await expect(alert.getByRole("link", { name: "Leer mi CV" })).toHaveAttribute(
      "href",
      "/cv/perfil",
    );
  });
});

/** Un CV entero inventado: encabezados de sección y largo, como lo detecta `classifyCvChatInput`. */
const PASTED_CV = [
  "Persona Ficticia",
  "Perfil",
  "Experiencia laboral",
  "Educación",
  "Idiomas",
  "Skills",
  "Trabajé en reportes y tableros para equipos comerciales de varias sucursales. ".repeat(20),
].join("\n");
