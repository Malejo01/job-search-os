import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, eq, like, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, ownerDb } from "./helpers";

/**
 * Flujo 135 (R11-1, ADR-034 y docs/beta/agente-perfil-pruebas.md §6): el recorrido completo del agente de
 * perfil con el modelo en demo (`LLM_DEMO=1`, sin red ni gasto): elección en el onboarding → subir (pegar) el
 * CV → tarjetas → recargar sin gastar otra lectura → guardar lo aceptado → huecos → guía → cierre (CV para ATS).
 *
 * El servidor de los e2e corre con `CV_IMPORT_ENABLED=1` y `CV_PROFILE_AGENT=testers`; la persona nueva de este
 * flujo es tester solo por su email (`ASSISTANT_TESTER_EMAILS` en playwright.config.ts). No corre en local: lo
 * corre el CI. CV de prueba inventado (`packages/pipeline/test/fixtures/cv-perfil/`); la persona se borra al
 * final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

const EMAIL = "agente-perfil-135@onboarding.test";
const PASSWORD = "agente-clave-local-135";
const CV_TEXT = readFileSync(
  join(__dirname, "../../../packages/pipeline/test/fixtures/cv-perfil/con-experiencia.txt"),
  "utf8",
);

async function cleanup(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, EMAIL));
    if (user) {
      await db
        .transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
          await deleteUserData(tx as never, user.id);
        })
        .catch(() => {});
      await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
    }
    await db.delete(s.invitations).where(eq(s.invitations.email, EMAIL));
  } finally {
    await close();
  }
}

async function counts(): Promise<{ reads: number; calls: number; cvHistory: number }> {
  const { db, close } = ownerDb();
  try {
    const [user] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, EMAIL));
    if (!user) return { reads: 0, calls: 0, cvHistory: 0 };
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    return {
      reads: await n(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.userId, user.id), eq(s.llmCalls.task, "profile_read"))),
      ),
      calls: await n(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.llmCalls)
          .where(and(eq(s.llmCalls.userId, user.id), like(s.llmCalls.label, "cv:%"))),
      ),
      cvHistory: await n(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(s.careerHistory)
          .where(and(eq(s.careerHistory.userId, user.id), eq(s.careerHistory.source, "cv"))),
      ),
    };
  } finally {
    await close();
  }
}

test.describe("Flujo 135: agente de perfil desde el CV, recorrido completo", () => {
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("elegir, leer, recargar sin gastar cupo, guardar, huecos, guía y cierre", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    // Alta por invitación, como una persona nueva
    const code = randomBytes(32).toString("base64url");
    const { db, close } = ownerDb();
    try {
      await db.insert(s.invitations).values({
        codeHash: createHash("sha256").update(code).digest("hex"),
        email: EMAIL,
        createdByUserId: E2E_USER_ID,
      });
    } finally {
      await close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      let reads = 0;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().endsWith("/api/cv-perfil/leer")) reads++;
      });

      await page.goto(`/register?code=${code}`);
      await page.getByLabel("Email").fill(EMAIL);
      await page.getByLabel("Nombre (opcional)").fill("Persona Agente Perfil");
      await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
      await page.getByLabel("Repetí la contraseña").fill(PASSWORD);
      await page.getByLabel(/Leí y acepto/).check();
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await page.waitForURL("**/onboarding**");

      // 1. La elección: «a mano» la oculta y deja el formulario como hoy; recargar la trae de nuevo
      await expect(page.getByTestId("pa-onboarding-choice")).toBeVisible();
      await page.getByTestId("pa-onboarding-manual").click();
      await expect(page.getByTestId("pa-onboarding-choice")).toHaveCount(0);
      await expect(page.getByLabel(/Resumen de tu perfil/)).toBeVisible();
      await page.reload();
      await page.getByTestId("pa-onboarding-cv").click();

      // 2. Lectura: se pega el texto (el PDF necesita pdfjs-dist, ver docs/beta/agente-perfil-pruebas.md)
      await page.waitForURL("**/onboarding/cv");
      await expect(page.getByTestId("profile-read-zone")).toBeVisible();
      await page.getByTestId("profile-read-text").fill(CV_TEXT);
      await page.getByTestId("profile-read-submit").click();
      await expect(page.getByTestId("profile-cards")).toBeVisible();
      await expect(page.getByTestId("profile-read-notice")).toHaveCount(0);
      expect(reads).toBe(1);
      expect((await counts()).reads).toBe(1);

      // 3. Recargar antes de guardar no vuelve a leer ni gasta cupo: la propuesta sigue en la pestaña
      await page.reload();
      await expect(page.getByTestId("profile-cards")).toBeVisible();
      await expect(page.locator('[data-testid^="card-exp"]').first()).toBeVisible();
      expect(reads).toBe(1);
      expect((await counts()).reads).toBe(1);

      // 4. Tarjetas: se acepta la primera de experiencia; solo eso queda en `career_history` (source = cv)
      expect((await counts()).cvHistory).toBe(0);
      const exp = page.locator('[data-testid^="card-exp"]').first();
      await exp.getByRole("button", { name: "Aceptar", exact: true }).click();
      await page.getByTestId("profile-cards-save").click();
      await expect(exp.getByRole("status")).toContainText(/Guardada|Actualizada/);
      expect((await counts()).cvHistory).toBe(1);
      // lo resuelto no vuelve al recargar; la lectura tampoco se repite
      await page.reload();
      await expect(page.getByTestId("profile-cards")).toBeVisible();
      await expect(exp).toHaveCount(0);
      expect(reads).toBe(1);

      // 5. Huecos: una pregunta por vez, con «No tengo»; la plantilla no deja llaves a la vista
      await page.getByTestId("profile-cards-next").click();
      await page.waitForURL("**/onboarding/cv/huecos");
      const question = page.getByTestId("gaps-question");
      const done = page.getByTestId("gaps-done");
      const gapCard = page.getByTestId("gaps-card");
      for (let i = 0; i < 20; i++) {
        await expect(question.or(done).or(gapCard)).toBeVisible();
        if (await done.isVisible()) break;
        if (await gapCard.isVisible()) {
          await gapCard.getByRole("button", { name: "Descartar" }).click();
          continue;
        }
        await expect(page.getByTestId("gaps-question-text")).not.toContainText(/[{}]/);
        await question.getByRole("button", { name: "No tengo" }).click();
      }
      await expect(done).toBeVisible();

      // 6. Guía: sin promesas en el copy; criterios y país no se escriben antes de completar el onboarding
      await page.getByRole("link", { name: "Seguir con la guía de búsqueda" }).click();
      await page.waitForURL("**/onboarding/cv/guia");
      const step = page.getByTestId("guide-step");
      const cards = page.getByTestId("guide-cards");
      for (let i = 0; i < 10; i++) {
        await expect(step.or(cards)).toBeVisible();
        if (await cards.isVisible()) break;
        const country = page.locator("#guide-country");
        if (await country.isVisible()) {
          await country.selectOption("AR");
          await page.getByRole("button", { name: "Continuar" }).click();
        } else {
          await step.getByRole("button", { name: "Saltear" }).click();
        }
      }
      await expect(cards).toBeVisible();
      await expect(cards).not.toContainText(/garantizamos|conseguirás|te van a llamar|sueldo de/i);
      await page.getByRole("link", { name: "Seguir al CV" }).click();

      // 7. Cierre: vista previa del CV para ATS, guardar viñetas, Word y «qué sigue»
      await page.waitForURL("**/onboarding/cv/listo");
      await expect(page.getByTestId("pa-close")).toBeVisible();
      await page.getByTestId("pa-close-write").click();
      await expect(page.getByTestId("cv-preview")).toBeVisible();
      await page.getByTestId("pa-close-save").click();
      await expect(page.getByTestId("pa-close-saved")).toBeVisible();
      await expect(page.getByTestId("pa-close-docx")).toBeVisible();
      await expect(page.getByTestId("pa-next")).toBeVisible();
      // El resumen ya no viaja por el navegador: no queda ninguna clave de resumen en la pestaña
      expect(await page.evaluate(() => window.sessionStorage.getItem("jso:pa:summary"))).toBeNull();

      // 8. De vuelta en el onboarding: ya pasó por el agente, así que la elección no se ofrece de nuevo
      await page.goto("/onboarding");
      await expect(page.getByRole("heading", { name: "Completá tu perfil" })).toBeVisible();
      await expect(page.getByTestId("pa-onboarding-choice")).toHaveCount(0);

      // 9. Datos: hay filas con `label = cv:<id>` (lectura, huecos y cierre) y solo una lectura descontada
      const final = await counts();
      expect(final.calls).toBeGreaterThan(0);
      expect(final.reads).toBe(1);
      expect(final.cvHistory).toBe(1);
    } finally {
      await context.close();
    }
  });
});
