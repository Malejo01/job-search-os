import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 184 (R23-04): ayudas «?» completas. Las fichas están en borrador hasta que Ani las apruebe y
 * un «?» sin ficha aprobada no se dibuja, así que el spec es condicional: si hay «?» en Hoy, su enlace
 * a Academy lleva `?desde=` de una lista cerrada y axe no marca violaciones. Con el usuario del seed.
 */
test.describe("Flujo 184: ayudas «?» completas (R23-04)", () => {
  test("Hoy: los «?» presentes enlazan a Academy con un origen válido", async ({ page }) => {
    await login(page);
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
      expect(href).toMatch(
        /^\/academy\/[a-z0-9-]+\?desde=(interview|cv|avisos|postulacion|perfil)$/,
      );
    }
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });

  test("CV: sin violaciones de axe con los «?» nuevos", async ({ page }) => {
    await login(page);
    await page.goto("/cv");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });
});
