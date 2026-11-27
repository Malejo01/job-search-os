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
  expect(chip).not.toBeNull();
  // Las pestañas de abajo existen en Hoy y Ofertas. En el detalle de una oferta NO hay barra (R30-10 y C10-8:
  // `MobileTabBar` devuelve `null` con `DETAIL`): el botón de salida «Ir a postularme» va arriba y fijo
  // (`salida-cel`). Este test asumía la barra también ahí; eso era el dato viejo, no un error del código.
  const enDetalle = /\/jobs\/[0-9a-f-]{36}$/.test(new URL(page.url()).pathname);
  const bar = page.getByTestId("tabbar");
  if (enDetalle) {
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId("salida-cel")).toBeVisible();
  } else {
    const b = await bar.boundingBox();
    expect(b).not.toBeNull();
    expect(chip!.y + chip!.height).toBeLessThanOrEqual(b!.y);
  }
  // Lo que importa en los tres casos: nada fijo lo tapa. El punto central del botón cae sobre el botón mismo
  // (un elemento fijo encima, sea la barra o el botón de salida, lo robaría).
  const cubierto = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="feedback-inline"] button');
    if (!el) return true;
    const r = el.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !(arriba && el.contains(arriba));
  });
  expect(cubierto).toBe(false);
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
    // El primer link a /jobs/ es «+ Cargar oferta» (/jobs/new): se busca el de una oferta (UUID)
    const first = page
      .locator('a[href^="/jobs/"]:not([href^="/jobs/new"]):not([href^="/jobs/pending"])')
      .filter({ hasNotText: /^$/ })
      .first();
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
