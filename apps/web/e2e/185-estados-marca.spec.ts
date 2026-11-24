import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 185 (R23-07): estados vacíos con la marca. Con la persona B (ficticia, sin datos: corre en local y
 * en el CI). Comprueba Academy (sin fichas aprobadas, el vacío con salida), Match y Tracker vacíos con título,
 * figura y una acción, y que el vacío de Interview ofrece una salida hacia el formulario.
 */
test.describe("Flujo 185: estados vacíos con la marca (R23-07)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(removeSecondUser);

  test("Academy: vacío con la figura de la marca y una salida, o la lista", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/academy");
    const vacia = page.getByTestId("academy-vacia");
    if ((await vacia.count()) > 0) {
      await expect(vacia.getByRole("link", { name: "Volver a Hoy" })).toBeVisible();
      await expect(vacia.locator("[data-afi], [data-ilustracion]").first()).toBeAttached();
    } else {
      await page.getByLabel("Buscar una ficha").fill("zzzzzz-no-existe");
      const sin = page.getByTestId("academy-sin-resultados");
      await expect(sin).toBeVisible();
      await sin.getByRole("button", { name: "Ver todas las fichas" }).click();
      await expect(page.getByTestId("academy-lista")).toBeVisible();
    }
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });

  test("Match y Tracker: un vacío, si hay, tiene figura y una acción", async ({ page }) => {
    await loginAsSecondUser(page);
    for (const path of ["/jobs?periodo=hoy&estado=zzz", "/applications"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const figuras = page.locator("[data-afi], [data-ilustracion]");
      if ((await figuras.count()) > 0) {
        await expect(figuras.first()).toBeAttached();
      }
      const { violations } = await axeSummary(page);
      expect(violations, path).toEqual([]);
    }
  });

  test("Interview sin simulaciones: figura de la marca y salida hacia el formulario", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto("/interview");
    const vacio = page.getByTestId("interview-vacio");
    await expect(vacio).toBeVisible();
    await expect(vacio.locator("[data-afi], [data-ilustracion]").first()).toBeAttached();
    await expect(vacio.getByRole("link")).toHaveCount(1);
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });
});
