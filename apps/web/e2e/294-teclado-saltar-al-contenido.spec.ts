import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { expectFocusVisible } from "./teclado-helpers";

/**
 * Flujo 294 (R28-08): «Saltar al contenido» y el orden del foco en las pantallas de la app, solo con teclado.
 * Persona B (ficticia). El primer Tab llega al enlace, se ve, Enter lleva el foco a `main` y el Tab siguiente
 * sigue dentro del contenido. Desde `/hoy`, `/jobs` y `/cv`.
 */
test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Flujo 294: saltar al contenido con teclado (R28-08)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  for (const ruta of ["/hoy", "/jobs", "/cv"]) {
    test(`en ${ruta}: el primer Tab es el salto, Enter va a main y Tab sigue en el contenido`, async ({
      page,
    }) => {
      await loginAsSecondUser(page);
      await page.goto(ruta);
      await expect(page.locator("main#contenido")).toBeAttached();
      // Pantalla recién cargada: el primer Tab parte del principio del documento
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press("Tab");
      const salto = page.getByRole("link", { name: "Saltar al contenido" });
      await expect(salto, "el primer Tab llega al enlace de salto").toBeFocused();
      await expectFocusVisible(page, "Saltar al contenido");
      const caja = await salto.boundingBox();
      expect(caja?.width ?? 0).toBeGreaterThan(20);
      expect(caja?.height ?? 0).toBeGreaterThan(10);

      // El segundo Tab sigue en el encabezado (el logo): el salto va primero y no se come el orden
      await page.keyboard.press("Tab");
      const fuera = await page.evaluate(
        () => !document.getElementById("contenido")?.contains(document.activeElement),
      );
      expect(fuera, "el segundo Tab sigue en el encabezado").toBe(true);

      // De vuelta al salto con Mayús+Tab y Enter
      await page.keyboard.press("Shift+Tab");
      await expect(salto).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("main#contenido")).toBeFocused();
      await page.keyboard.press("Tab");
      const adentro = await page.evaluate(
        () => document.getElementById("contenido")?.contains(document.activeElement) ?? false,
      );
      expect(adentro, "después del salto, Tab sigue dentro del contenido").toBe(true);
    });
  }
});
