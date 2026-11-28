import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { ownerDb } from "./helpers";

/**
 * Flujo 160 (R22-03): vencimiento del plan. Con persona propia (inventada, solo en la base local):
 * - a 5 días de vencer, `/hoy` muestra el aviso con los días que quedan y el link a «Tu plan»;
 * - con el plan vencido, `/hoy` muestra el bloque amable: qué sigue igual y qué no incluye el plan gratis;
 * - con el plan vencido, nada se borró (el perfil sigue ahí) y no hay urgencia falsa ni promesas.
 *
 * Necesita `PRICING_ENABLED=1` en el servidor del e2e (el aviso y el bloque solo existen con los precios
 * encendidos); en el CI está apagado y se saltea, igual que el flujo 151.
 */
const ON = process.env.PRICING_ENABLED === "1";
const EMAIL = "persona-vencimiento@plan.test";
const PASSWORD = "dev-password-vencimiento-local";
const USER_ID = "c0000000-0000-4000-8000-000000000160";
const DAY = 86_400_000;

async function ensureUser(planUntil: Date): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: USER_ID,
        email: EMAIL,
        name: "Persona Vencimiento",
        passwordHash: hashPassword(PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: USER_ID,
        displayName: "Persona Vencimiento",
        locationCountry: "AR",
        careerAskedAt: new Date(), // R32-01: sin puestos, ya «pedida»
        inboundAddress: "u_vencimiento_160@ingest.test",
        profileSummary:
          "Perfil ficticio para el e2e del vencimiento del plan. No corresponde a nadie real y solo existe en la base local.",
        plan: "lista",
        planSource: "pago",
        planUntil,
      })
      .onConflictDoUpdate({
        target: s.profiles.userId,
        set: { plan: "lista", planSource: "pago", planUntil },
      });
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: USER_ID, version: 1, active: true, rules: {} as never });
    }
  } finally {
    await close();
  }
}

async function removeUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, USER_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, USER_ID));
    await db.delete(s.users).where(eq(s.users.id, USER_ID));
  } finally {
    await close();
  }
}

async function loginAsUser(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(EMAIL);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}

test.describe("Flujo 160: vencimiento del plan", () => {
  test.skip(!ON, "necesita PRICING_ENABLED=1 en el servidor del e2e");
  test.afterAll(async () => {
    await removeUser();
  });

  test("a 5 días de vencer, Hoy avisa cuántos quedan y lleva a «Tu plan»", async ({ page }) => {
    await ensureUser(new Date(Date.now() + 5 * DAY));
    await loginAsUser(page);
    const aviso = page.getByTestId("aviso-plan");
    await expect(aviso).toContainText(/Te quedan [45] días/);
    await expect(aviso.getByRole("link")).toHaveAttribute("href", "/settings#tu-plan");
    await expect(page.getByTestId("hoy-plan-vencido")).toHaveCount(0);
  });

  test("con el plan vencido, Hoy explica qué sigue igual y qué se pausa, sin urgencia ni promesas", async ({
    page,
  }) => {
    await ensureUser(new Date(Date.now() - 2 * DAY));
    await loginAsUser(page);
    const bloque = page.getByTestId("hoy-plan-vencido");
    await expect(bloque).toBeVisible();
    await expect(bloque).toContainText("No se borró nada");
    await expect(bloque).toContainText("Lo que sigue igual");
    await expect(bloque).toContainText("Lo que el plan gratis no incluye");
    await expect(bloque).toContainText("ofertas por día");
    await expect(bloque.getByRole("link")).toHaveAttribute("href", "/settings#tu-plan");
    await expect(bloque.getByText(/garant|últimos|última oportunidad|urgente/i)).toHaveCount(0);
    // Nada se borró: el perfil sigue en Ajustes
    await page.goto("/settings");
    await expect(page.getByTestId("tu-plan")).toContainText("Gratis");
  });
});
