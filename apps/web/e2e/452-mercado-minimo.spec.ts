import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 452 (R34-03): `/market` mínimo. Una sola página para la carrera de la persona, con cuatro bloques que
 * dicen de cuántos avisos salen y de qué fecha, y terminan cada uno en una acción. Lo que se sacó (la agenda de
 * habilidades, el rango de semanas, el selector de otras carreras) ya no está.
 *
 * El servidor cachea 30 minutos el pool de cada carrera y otros flujos pueden haberlo leído antes: no se
 * verifican números, solo la estructura. Sin red, sin datos de nadie.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 452: mercado mínimo", () => {
  let original: { targetRole: string | null; targetRoles: string[] } | null = null;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [profile] = await db
        .select({ targetRole: s.profiles.targetRole, targetRoles: s.profiles.targetRoles })
        .from(s.profiles)
        .where(eq(s.profiles.userId, E2E_USER_ID));
      if (!profile) throw new Error("el usuario e2e necesita perfil");
      original = profile;
      await db
        .update(s.profiles)
        .set({ targetRole: "qa", targetRoles: ["qa"] })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    if (!original) return;
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.profiles)
        .set({ targetRole: original.targetRole, targetRoles: original.targetRoles })
        .where(eq(s.profiles.userId, E2E_USER_ID));
    } finally {
      await close();
    }
  });

  for (const width of [1280, 390]) {
    test(`estructura, fuente de cada dato y acciones a ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.goto("/market");
      await expect(page.getByRole("heading", { level: 1 })).toContainText("Mercado de");

      // Lo que salió de la pantalla
      await expect(page.getByText("Tu agenda de skills")).toHaveCount(0);
      await expect(page.getByText("Desde (semana)")).toHaveCount(0);
      await expect(page.getByText("Explorar otra carrera")).toHaveCount(0);
      await expect(page.locator("details")).toHaveCount(0);

      const vacio = page.getByTestId("market-vacio");
      if ((await vacio.count()) === 0) {
        for (const id of [
          "market-ofertas",
          "market-habilidades",
          "market-modalidad",
          "market-sueldos",
        ]) {
          const block = page.getByTestId(id);
          await expect(block).toBeVisible();
          // De cuántos avisos sale y de qué fecha
          await expect(block).toContainText(/Sale de [\d.]+ avisos? vigentes?/);
          await expect(block).toContainText(/Datos del \d{2}\/\d{2}\/\d{4}/);
          // Y termina en una acción
          expect(await block.getByRole("link").count()).toBeGreaterThan(0);
        }
        await expect(page.getByTestId("market-ofertas")).toContainText(
          "las podés tomar desde tu país",
        );
        await expect(page.getByTestId("market-ofertas")).toContainText("son para quien empieza");
        await expect(
          page.getByTestId("market-habilidades").getByRole("link", {
            name: "Cargar mis habilidades",
          }),
        ).toHaveAttribute("href", "/settings/skills");
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
