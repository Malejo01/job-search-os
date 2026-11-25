import { expect, test } from "@playwright/test";
import { abrirPanel, afiSetup } from "./afi-helpers";

/**
 * Flujo 253 (R27-03): el panel del asistente abre con el nombre de Afi y con su pose. Un solo Afi animado por
 * pantalla: con el panel abierto, el del botón no se anima.
 */
afiSetup();

test.describe("Flujo 253: panel del asistente con Afi (R27-03)", () => {
  test("abre con el nombre en el título y Afi quieto antes de la primera pregunta", async ({
    page,
  }) => {
    const { panel } = await abrirPanel(page);
    await expect(panel.getByRole("heading", { level: 2, name: "Afi", exact: true })).toBeVisible();
    await expect(panel.locator("[data-afi]")).toHaveAttribute("data-afi", "quieto");
    // Decorativo: el nombre ya está en el título
    await expect(panel.locator("[data-afi] img")).toHaveAttribute("alt", "");
  });

  test("un solo Afi animado por pantalla", async ({ page }) => {
    await abrirPanel(page);
    await expect(page.locator("[data-afi-animado]")).toHaveCount(1);
  });
});
