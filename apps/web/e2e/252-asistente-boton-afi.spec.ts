import { expect, test } from "@playwright/test";
import { AFI_BOTON, afiSetup, entrarYBuscarBoton } from "./afi-helpers";

/**
 * Flujo 252 (R27-03): el botón flotante del asistente es la cara de Afi sobre el círculo lavanda, con su
 * `aria-label`, y cumple los 44 px también en el celular.
 */
afiSetup();

test.describe("Flujo 252: botón del asistente con la cara de Afi (R27-03)", () => {
  test("escritorio: cara, aria-label y círculo", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const boton = await entrarYBuscarBoton(page);
    await expect(boton).toHaveAttribute("aria-label", AFI_BOTON);
    const cara = boton.locator('[data-afi="cara"]:visible');
    await expect(cara).toHaveCount(1);
    const img = cara.locator("img");
    await expect(img).toHaveAttribute("src", /\/mascota\/cara-\d+\.webp$/);
    await expect(img).toHaveAttribute("alt", "");
    const box = await boton.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    // El círculo es CSS (lavanda, igual en los dos temas), no está en la imagen
    const fondo = await boton.evaluate((n) => getComputedStyle(n).backgroundColor);
    expect(fondo).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("celular (390 px): la cara entra en 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const boton = await entrarYBuscarBoton(page);
    const box = await boton.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const cara = boton.locator('[data-afi="cara"]:visible');
    await expect(cara).toHaveCount(1);
    const c = await cara.boundingBox();
    expect(c!.width).toBeLessThanOrEqual(box!.width);
    // Sigue sin tapar las pestañas
    const bar = await page.getByTestId("tabbar").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  });
});
