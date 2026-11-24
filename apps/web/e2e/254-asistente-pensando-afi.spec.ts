import { expect, test } from "@playwright/test";
import { abrirPanel, afiSetup } from "./afi-helpers";

/**
 * Flujo 254 (R27-03): mientras el asistente responde, Afi «piensa» (pose `pensando` y el texto «Afi está
 * pensando…»); al llegar la respuesta pasa a `hablando-1`. Corre con el modelo simulado (`LLM_DEMO=1`); la
 * respuesta se demora a propósito 2 s para poder ver la espera.
 */
afiSetup();

test.describe("Flujo 254: Afi piensa y habla en el asistente (R27-03)", () => {
  test("pensando mientras espera y hablando-1 al mostrar la respuesta", async ({ page }) => {
    await page.route("**/api/assistant", async (route) => {
      await new Promise((r) => setTimeout(r, 2000));
      await route.continue();
    });
    const { panel } = await abrirPanel(page);
    await panel.getByLabel("Tu mensaje").fill("Hola, ¿qué puedo hacer en esta pantalla?");
    await panel.getByRole("button", { name: "Enviar" }).click();

    await expect(panel.locator('[data-afi="pensando"]')).toBeVisible();
    await expect(panel.getByText("Afi está pensando…")).toBeVisible();

    await expect(panel.locator('[data-afi="hablando-1"]')).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByText("Afi está pensando…")).toHaveCount(0);
  });
});
