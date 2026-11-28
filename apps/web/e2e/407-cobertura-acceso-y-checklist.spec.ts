import { expect, test } from "@playwright/test";
import { ensureSecondUser, login, loginAsSecondUser } from "./helpers";

/**
 * Flujo 407 (R32-02): quién ve `/admin/cobertura` y cómo la lee la checklist de `/admin/apertura`.
 * Una cuenta que no es admin (la B, tester) recibe 404 en la pantalla. La checklist trae el ítem de
 * cobertura y su estado es coherente con el panel: «listo» solo si las 8 carreras están en verde. La parte de
 * admin necesita la cuenta A como admin: en local no lo es y se saltea; en el CI sí.
 */
test.describe("Flujo 407: acceso y checklist de cobertura", () => {
  test("una cuenta que no es admin recibe 404", async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
    const response = await page.goto("/admin/cobertura");
    expect(response?.status()).toBe(404);
  });

  test("la checklist de apertura lee la cobertura carrera por carrera", async ({ page }) => {
    await login(page);
    const panel = await page.goto("/admin/cobertura");
    test.skip(panel?.status() === 404, "La cuenta e2e no es admin en este entorno");
    const verdes = await page
      .locator('[data-testid="cobertura-carrera"][data-semaforo="verde"]')
      .count();
    const total = await page.getByTestId("cobertura-carrera").count();

    await page.goto("/admin/apertura");
    const fila = page.getByTestId("apertura-cobertura");
    await expect(fila).toBeVisible();
    if (verdes === total) {
      await expect(fila).toHaveAttribute("data-estado", "listo");
    } else {
      await expect(fila).toHaveAttribute("data-estado", "pendiente");
      await expect(fila).toContainText(`${verdes} de ${total} carreras en verde`);
      await expect(fila).toContainText("tomables");
      await expect(fila.getByRole("link", { name: /cobertura/ })).toBeVisible();
    }
  });
});
