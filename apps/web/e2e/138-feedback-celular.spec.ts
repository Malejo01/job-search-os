import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 138 (R11-13): en el celular (390 px) «¿Algo no anduvo?» ya no flota sobre el contenido. Va en el
 * flujo de la página, al final, y no queda debajo de las pestañas ni del botón fijo «Postularme». Se
 * prueba en Hoy, Ofertas y el detalle de una oferta.
 */
test.use({ viewport: { width: 390, height: 844 } });

async function expectInlineAndClear(page: Page) {
  const inline = page.getByTestId("feedback-inline").getByRole("button", {
    name: "¿Algo no anduvo?",
  });
  // El flotante de escritorio no existe en el celular: un solo botón visible, y no es `fixed`
  await expect(page.getByRole("button", { name: "¿Algo no anduvo?" })).toHaveCount(1);
  await expect(inline).toHaveCSS("position", "static");
  await inline.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const chip = await inline.boundingBox();
  const bar = await page.getByTestId("tabbar").boundingBox();
  expect(chip).not.toBeNull();
  expect(bar).not.toBeNull();
  expect(chip!.y + chip!.height).toBeLessThanOrEqual(bar!.y);
  const apply = page.getByRole("link", { name: /Postularme/ });
  if (await apply.first().isVisible()) {
    const a = await apply.first().boundingBox();
    expect(chip!.y + chip!.height <= a!.y || a!.y + a!.height <= chip!.y).toBe(true);
  }
}

test.describe("Flujo 138: «¿Algo no anduvo?» en el celular", () => {
  test("Hoy y Ofertas: en el flujo, sin tapar nada", async ({ page }) => {
    await login(page);
    for (const path of ["/hoy", "/jobs"]) {
      await page.goto(path);
      await expectInlineAndClear(page);
    }
  });

  test("el detalle de una oferta: tampoco lo tapa el botón fijo", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    const first = page.locator('a[href^="/jobs/"]').filter({ hasNotText: /^$/ }).first();
    test.skip((await first.count()) === 0, "el usuario de e2e no tiene ofertas en esta base");
    await first.click();
    await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/);
    await expectInlineAndClear(page);
  });

  test("sigue abriendo el formulario", async ({ page }) => {
    await login(page);
    await page.goto("/hoy");
    await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
    await expect(page.getByRole("dialog", { name: "Contanos qué pasó" })).toBeVisible();
  });
});
