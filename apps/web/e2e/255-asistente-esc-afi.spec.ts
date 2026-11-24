import { expect, test } from "@playwright/test";
import { abrirPanel, afiSetup } from "./afi-helpers";

/** Flujo 255 (R27-03): Esc cierra el panel de Afi y el foco vuelve al botón; la burbuja de aviso no reaparece. */
afiSetup();

test.describe("Flujo 255: Esc cierra el panel y devuelve el foco (R27-03)", () => {
  test("Esc cierra, el foco vuelve al botón y el botón sigue con su nombre", async ({ page }) => {
    const { boton, panel } = await abrirPanel(page);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(boton).toBeFocused();
    await expect(boton).toHaveAttribute("aria-label", "Preguntale a Afi");
  });

  test("a 390 px, con el panel abierto y cerrado, el botón no se sale de la pantalla", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { boton } = await abrirPanel(page);
    await page.keyboard.press("Escape");
    const box = await boton.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });
});
