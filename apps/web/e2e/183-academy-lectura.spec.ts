import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 183 (R23-03): Academy, lectura cómoda. Mientras ninguna ficha esté aprobada (la aprobación es de
 * Ani), `/academy` muestra el vacío y el detalle da 404: el spec comprueba eso y que `?desde=` no
 * rompe ni deja ver borradores. Si ya hay fichas aprobadas, prueba además el buscador y el pie de
 * relacionadas. Con la persona B (ficticia, la crea y la borra el propio spec): corre en local y en el CI.
 */
test.describe("Flujo 183: Academy, lectura cómoda (R23-03)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(removeSecondUser);

  test("lista: vacío o buscador, sin violaciones de axe", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/academy");
    await expect(page.getByRole("heading", { level: 1, name: "Academy" })).toBeVisible();

    const lista = page.getByTestId("academy-lista");
    if ((await lista.count()) === 0) {
      await expect(page.getByTestId("academy-vacia")).toBeVisible();
    } else {
      const total = await lista.getByRole("link").count();
      const buscador = page.getByLabel("Buscar una ficha");
      await buscador.fill("zzzzzz-no-existe");
      await expect(page.getByTestId("academy-sin-resultados")).toBeVisible();
      await buscador.fill("");
      await expect(page.getByTestId("academy-lista").getByRole("link")).toHaveCount(total);
      await expect(page.getByTestId("academy-resultados")).toContainText(`${total} fichas`);
    }
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });

  test("detalle: una ficha en borrador da 404 aunque venga con ?desde=interview", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    const res = await page.goto("/academy/metodo-star?desde=interview");
    const aprobada = (await page.getByTestId("academy-lectura").count()) > 0;
    if (aprobada) {
      await expect(page.getByTestId("academy-lectura")).toContainText("min de lectura");
      await expect(page.getByTestId("academy-te-puede-servir")).toHaveCount(0); // ya es esta ficha
    } else {
      expect(res?.status()).toBe(404);
    }
  });

  test("una ficha que no existe da 404 y un origen fuera de la lista no cambia nada", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    const res = await page.goto("/academy/esta-ficha-no-existe");
    expect(res?.status()).toBe(404);
    await page.goto("/academy?desde=https://example.com");
    await expect(page.getByRole("heading", { level: 1, name: "Academy" })).toBeVisible();
  });
});
