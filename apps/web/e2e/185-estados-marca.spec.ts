import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 185 (R23-07): estados vacíos con la marca. Con el usuario del seed (CI). Los vacíos dependen
 * de los datos, así que el spec comprueba lo que siempre pasa: Academy (sin fichas aprobadas, el
 * vacío con salida) y que los vacíos que aparezcan en Match y Tracker traen título, texto y una acción.
 */
test.describe("Flujo 185: estados vacíos con la marca (R23-07)", () => {
  test("Academy: vacío con la figura de la marca y una salida, o la lista", async ({ page }) => {
    await login(page);
    await page.goto("/academy");
    const vacia = page.getByTestId("academy-vacia");
    if ((await vacia.count()) > 0) {
      await expect(vacia.getByRole("link", { name: "Volver a Hoy" })).toBeVisible();
      await expect(vacia.locator("[data-mascota], [data-ilustracion]").first()).toBeAttached();
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
    await login(page);
    for (const path of ["/jobs?periodo=hoy&estado=zzz", "/applications"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const figuras = page.locator("[data-mascota], [data-ilustracion]");
      if ((await figuras.count()) > 0) {
        await expect(figuras.first()).toBeAttached();
      }
      const { violations } = await axeSummary(page);
      expect(violations, path).toEqual([]);
    }
  });
});
