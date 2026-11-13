import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 132 (R7-3): el tope de mensajes del asistente.
 * Con el modelo simulado (`LLM_DEMO=1`, sin llamadas pagas):
 * - con más de 2 mensajes por delante no hay aviso de cuántos quedan;
 * - con 2 y con 1 restante aparece «Te quedan 2 mensajes…» / «Te queda 1 mensaje…»;
 * - al llegar al tope sale UN solo aviso de tope, no se puede enviar más y «Nueva charla»
 *   vuelve a dejar escribir, sin aviso ni conteo.
 * El 20 sale de `AGENT_LIMITS.maxTurnsPerConversation` (R9-2: antes 10; se puede cambiar con
 * `ASSISTANT_MAX_TURNS`, y el CI no la define); acá solo se cuentan respuestas. Con 20 vueltas el
 * test dura el doble, por eso el timeout pasa de 120 a 240 s.
 */

const TOTAL = 20;

async function openAssistant(page: Page) {
  const button = page.getByRole("button", { name: "Abrir asistente", exact: true });
  if ((await button.count()) === 0) {
    expect(process.env.CI, "En el CI la mascota del asistente tiene que estar").toBeFalsy();
    test.skip(true, "El asistente no está encendido para el usuario e2e");
  }
  await button.click();
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Flujo 132: tope de mensajes del asistente", () => {
  test("avisa cuántos quedan, muestra el tope una sola vez y bloquea el envío", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await login(page);
    await page.goto("/hoy");
    const panel = await openAssistant(page);
    const remaining = panel.getByTestId("assistant-remaining");
    const notices = panel.getByTestId("assistant-notice");
    const send = panel.getByRole("button", { name: "Enviar" });

    for (let i = 1; i <= TOTAL; i += 1) {
      await panel.getByLabel("Tu mensaje").fill(`Pregunta ${i}`);
      await send.click();
      await expect(panel.locator("p", { hasText: "Asistente:" })).toHaveCount(i);
      if (i === TOTAL - 3) await expect(remaining).toHaveCount(0);
      if (i === TOTAL - 2)
        await expect(remaining).toHaveText("Te quedan 2 mensajes en esta charla");
      if (i === TOTAL - 1) await expect(remaining).toHaveText("Te queda 1 mensaje en esta charla");
    }

    // Tope: un solo aviso, sin conteo y sin poder enviar
    await expect(remaining).toHaveCount(0);
    await expect(notices).toHaveCount(1);
    await expect(notices).toContainText("tope de mensajes");
    await panel.getByLabel("Tu mensaje").fill("Una más");
    await expect(send).toBeDisabled();
    await expect(notices).toHaveCount(1);

    // Charla nueva: vuelve a andar, sin aviso
    await panel.getByRole("button", { name: "Nueva charla" }).click();
    await expect(notices).toHaveCount(0);
    await expect(remaining).toHaveCount(0);
    await panel.getByLabel("Tu mensaje").fill("Hola de nuevo");
    await expect(send).toBeEnabled();
  });
});
