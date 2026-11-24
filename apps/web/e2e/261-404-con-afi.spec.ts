import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";

/**
 * Flujo 261 (R27-05): el 404 público (sin sesión) muestra a la mascota quieta, una frase clara y una salida.
 * Sin login: corre contra cualquier base.
 */
test.describe("Flujo 261: 404 con la mascota (R27-05)", () => {
  test("una ruta que no existe da 404 con `quieto` y una salida", async ({ page }) => {
    const respuesta = await page.goto("/esta-pagina-no-existe-r27");
    expect(respuesta?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "No encontramos esta página" }),
    ).toBeVisible();
    const figura = page.locator('[data-afi="quieto"]').first();
    await expect(figura).toBeVisible();
    await expect(figura).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("link", { name: /Ir al inicio|Volver al inicio/ })).toBeVisible();
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });
});
