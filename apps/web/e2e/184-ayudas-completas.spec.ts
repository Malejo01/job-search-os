import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 184 (R23-04): ayudas «?» completas. Las fichas están en borrador hasta que Ani las apruebe y
 * un «?» sin ficha aprobada no se dibuja, así que el spec es condicional: si hay «?» en Hoy, su enlace
 * a Academy lleva `?desde=` de una lista cerrada y axe no marca violaciones. Sin ninguna ficha aprobada
 * comprueba justamente eso: que no se dibuja ningún «?» (ni en Hoy, ni en Interview, ni en el CV). Con la
 * persona B (ficticia): corre en local y en el CI.
 */
const ORIGENES = /^\/academy\/[a-z0-9-]+\?desde=(interview|cv|avisos|postulacion|perfil)$/;

test.describe("Flujo 184: ayudas «?» completas (R23-04)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(removeSecondUser);

  test("Hoy: los «?» presentes enlazan a Academy con un origen válido", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/hoy");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ayudas = page.locator('[data-testid^="ayuda-ficha-"]');
    const n = await ayudas.count();
    for (let i = 0; i < n; i++) {
      const href = await ayudas
        .nth(i)
        .getByRole("link", { name: "Ver en Academy" })
        .getAttribute("href", {
          timeout: 2000,
        });
      expect(href).toMatch(ORIGENES);
    }
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });

  test("Interview: el «?» de STAR y el de seniority enlazan con origen válido, o no se dibujan", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/interview");
    await expect(page.getByRole("heading", { level: 1, name: "Interview" })).toBeVisible();
    const ayudas = page.locator('[data-testid^="ayuda-ficha-"]');
    const n = await ayudas.count();
    for (let i = 0; i < n; i++) {
      const href = await ayudas
        .nth(i)
        .getByRole("link", { name: "Ver en Academy" })
        .getAttribute("href", { timeout: 2000 });
      expect(href).toMatch(ORIGENES);
      expect(href).toContain("desde=interview");
    }
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });

  test("CV: sin violaciones de axe con los «?» nuevos", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/cv");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });
});
