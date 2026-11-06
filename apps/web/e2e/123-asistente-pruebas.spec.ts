import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { TERMS_VERSION } from "../lib/terms";
import { ensureSecondUser, loginAsSecondUser, ownerDb, removeSecondUser } from "./helpers";

/**
 * Flujo 123 (R4-15): acceso de prueba al asistente, mascota y chip de soporte.
 *
 * Con `ASSISTANT_ENABLED=testers` el asistente lo ven los admins y los emails de
 * `ASSISTANT_TESTER_EMAILS` (acá, la persona B de los e2e de dos usuarios). Una persona común
 * (C, inventada) no ve la mascota y `POST /api/assistant` le da 403. Sin sesión, nada.
 *
 * Los casos que dependen del modo `testers` se saltean si el servidor de e2e no lo tiene:
 * playwright.config.ts exporta `E2E_ASSISTANT_MODE` al runner junto con la variable del server.
 * El caso «sin sesión» corre siempre.
 */

const testersMode = process.env.E2E_ASSISTANT_MODE === "testers";
const COMMON_EMAIL = "usuario-c@asistente.test";
const COMMON_PASSWORD = "dev-password-c-local";
const COMMON_USER_ID = "c0000000-0000-4000-8000-000000000003";

/** Persona común: sesión válida, perfil completo, fuera de ADMIN_EMAILS y de la lista de prueba. */
async function ensureCommonUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: COMMON_USER_ID,
        email: COMMON_EMAIL,
        name: "Persona C",
        passwordHash: hashPassword(COMMON_PASSWORD),
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: COMMON_USER_ID,
        displayName: "Persona C",
        locationCountry: "AR",
        inboundAddress: "u_asistente_c@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona C para el e2e del asistente. No corresponde a nadie real y solo existe en la base local.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, COMMON_USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: COMMON_USER_ID, version: 1, active: true, rules: {} as never });
    }
  } finally {
    await close();
  }
}

async function removeCommonUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, COMMON_USER_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, COMMON_USER_ID));
    await db.delete(s.users).where(eq(s.users.id, COMMON_USER_ID));
  } finally {
    await close();
  }
}

async function loginAsCommonUser(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(COMMON_EMAIL);
  await page.getByLabel("Contraseña").fill(COMMON_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/hoy**");
}

const mascot = (page: Page) => page.getByRole("button", { name: "Abrir asistente", exact: true });
const chip = (page: Page) => page.getByRole("button", { name: "¿Algo no anduvo?" });

test.describe("Flujo 123: asistente con acceso de prueba", () => {
  test("sin sesión no aparece la mascota ni se llega a la app", async ({ page }) => {
    await page.goto("/hoy");
    // Sin usuarios en la base (local sin seed) la app manda a /setup en vez de /login
    await expect(page).toHaveURL(/\/(login|setup)/);
    await expect(page).not.toHaveURL(/\/hoy/);
    await expect(mascot(page)).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
  });

  test.describe("modo testers", () => {
    test.skip(!testersMode, "El server de e2e no está en ASSISTANT_ENABLED=testers");

    test.beforeAll(async () => {
      await ensureSecondUser();
      await ensureCommonUser();
    });
    test.afterAll(async () => {
      await removeCommonUser();
      await removeSecondUser();
    });

    test("la persona de prueba ve la mascota, abre el panel con el aviso y Esc cierra", async ({
      page,
    }) => {
      await loginAsSecondUser(page);
      const button = mascot(page);
      await expect(button).toBeVisible();
      await button.click();
      const panel = page.getByTestId("assistant-panel");
      await expect(panel).toBeVisible();
      const aviso = panel.getByTestId("assistant-aviso");
      await expect(aviso).toContainText("inteligencia artificial");
      await expect(aviso).toContainText("No escribas datos sensibles");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(button).toBeFocused();
    });

    test("una persona común no ve la mascota y POST /api/assistant le da 403", async ({ page }) => {
      await loginAsCommonUser(page);
      await expect(page.getByTestId("tabbar")).toBeVisible();
      await expect(mascot(page)).toHaveCount(0);
      // El chip de soporte sigue para todas las personas
      await expect(chip(page)).toBeVisible();
      const status = await page.evaluate(async () => {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", text: "hola" }] }),
        });
        return res.status;
      });
      expect(status).toBe(403);
    });

    test("a 390 px la mascota y el chip no se superponen ni tapan las pestañas", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await loginAsSecondUser(page);
      await page.goto("/hoy");
      const m = await mascot(page).boundingBox();
      const c = await chip(page).boundingBox();
      const bar = await page.getByTestId("tabbar").boundingBox();
      expect(m).not.toBeNull();
      expect(c).not.toBeNull();
      expect(bar).not.toBeNull();
      const separados =
        m!.x >= c!.x + c!.width ||
        c!.x >= m!.x + m!.width ||
        m!.y >= c!.y + c!.height ||
        c!.y >= m!.y + m!.height;
      expect(separados, "mascota y chip no se tocan").toBe(true);
      expect(m!.y + m!.height).toBeLessThanOrEqual(bar!.y);
      expect(c!.y + c!.height).toBeLessThanOrEqual(bar!.y);
      expect(m!.x + m!.width).toBeLessThanOrEqual(390);
      expect(c!.x).toBeGreaterThanOrEqual(0);
    });
  });
});
