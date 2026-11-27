import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 406 (R32-02): `/admin/cobertura` se lee en 390 y 360 px sin scroll horizontal, y se maneja con el
 * teclado (las definiciones se abren con Enter desde el foco). Necesita una cuenta admin: en local no lo es y
 * el flujo se saltea; en el CI sí. El axe de la pantalla lo corre el lead en la calidad de la tanda.
 */
for (const width of [390, 360]) {
  test.describe(`Flujo 406: pantalla de cobertura a ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test("sin scroll horizontal y con definiciones accesibles por teclado", async ({ page }) => {
      await login(page);
      const response = await page.goto("/admin/cobertura");
      test.skip(response?.status() === 404, "La cuenta e2e no es admin en este entorno");
      await expect(page.getByTestId("cobertura-carrera")).toHaveCount(8);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // Cada estado dice su texto: no depende solo del color
      for (const estado of await page.getByTestId("cobertura-estado").allInnerTexts()) {
        expect(estado).toMatch(/Lista para abrir|Cerca del umbral|Todavía no/);
      }

      // Teclado: se llega al resumen de las definiciones y Enter lo abre
      const resumen = page.locator("summary", { hasText: "Cómo se cuenta" });
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press("Tab");
        if (await resumen.evaluate((el) => el === document.activeElement)) break;
      }
      await expect(resumen).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("details[open]")).toHaveCount(1);
    });
  });
}
