import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 258 (R27-04): al terminar el CV con el coach, Afi festeja una sola vez. El coach deja una marca en
 * `sessionStorage` justo antes de ir a «Tu CV mejorado»; la pantalla la consume. Con la persona B. Si el
 * coach está apagado en este entorno (la ruta da 404), el test se saltea: no hay pantalla que probar.
 */
test.describe("Flujo 258: festejo al terminar el CV con el coach (R27-04)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("con la marca festeja, y recargar no lo repite", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.evaluate(() => sessionStorage.setItem("afinia:festejo:cv", "1"));
    const respuesta = await page.goto("/cv/coach/listo");
    test.skip(respuesta?.status() === 404, "el coach de CV está apagado en este entorno");
    const festejo = page.getByTestId("festejo");
    await expect(festejo).toBeVisible();
    await expect(festejo).toHaveAttribute("data-festejo", "cv");
    await page.getByRole("button", { name: "Cerrar el aviso" }).click();
    await expect(festejo).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId("festejo")).toHaveCount(0);
  });

  test("sin la marca (se entra por un enlace) no festeja", async ({ page }) => {
    await loginAsSecondUser(page);
    const respuesta = await page.goto("/cv/coach/listo");
    test.skip(respuesta?.status() === 404, "el coach de CV está apagado en este entorno");
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId("festejo")).toHaveCount(0);
  });
});
