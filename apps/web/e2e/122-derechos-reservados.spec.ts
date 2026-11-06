import { COPYRIGHT_NOTICE } from "@job-search-os/pipeline";
import { expect, test } from "@playwright/test";

/**
 * Flujo 122: el aviso «© 2026 AfinIAJobs. Todos los derechos reservados.» está en el pie de las
 * páginas sin sesión (español e inglés) y en el de las páginas legales, y el texto legal lo repite.
 * Sin sesión alcanza; el pie de la app con sesión usa el mismo componente (`CopyrightNotice`).
 */
test.describe("Flujo 122: derechos reservados", () => {
  for (const url of ["/", "/en/how-its-built", "/legal/terminos", "/legal/privacidad"]) {
    test(`el pie de ${url} lleva el aviso`, async ({ page }) => {
      await page.goto(url);
      const notice = page.locator("footer").getByTestId("copyright-notice");
      await expect(notice).toBeVisible();
      await expect(notice).toHaveText(COPYRIGHT_NOTICE);
    });
  }

  test("las páginas legales repiten el aviso y dejan la revisión con Camila a la vista", async ({
    page,
  }) => {
    for (const url of ["/legal/terminos", "/legal/privacidad"]) {
      await page.goto(url);
      const main = page.locator("main");
      await expect(main).toContainText(COPYRIGHT_NOTICE);
      await expect(main).toContainText("REVISAR CON CAMILA (abogada)");
    }
  });

  test("a 360 px el aviso no desborda la página", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect(page.locator("footer").getByTestId("copyright-notice")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
