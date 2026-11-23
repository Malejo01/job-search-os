import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  openInterview,
  prepareB,
  seedFullDailyCap,
} from "./voz-helpers";

/**
 * Flujo 224 (R25-06): el tope diario. Se le siembra a la persona B (inventada) una llamada de 1200 s dentro de las
 * últimas 24 h, que es todo el cupo. La grabación sale al servidor, que responde 429 `daily_limit`: la pantalla
 * muestra el mensaje del tope, el campo queda como estaba y se puede seguir escribiendo.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use({ ...FAKE_MIC, userAgent: OPERA_GX_UA });
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 224");
  await seedFullDailyCap();
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("con el cupo del día gastado muestra el tope y deja escribir", async ({ page }) => {
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Algo escrito");
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-escuchando")).toBeVisible();
  await page.waitForTimeout(1_500);

  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/transcribe")),
    page.getByTestId("voice-listo").click(),
  ]);
  // No se lee el cuerpo de la respuesta (se cuelga en Playwright): el mensaje se comprueba en pantalla
  expect(response.status()).toBe(429);

  await expect(page.getByTestId("voice-error")).toContainText("tope");
  await expect(campo).toHaveValue("Algo escrito");
  await campo.fill("Algo escrito y seguí a mano");
  await expect(page.getByTestId("interview-send")).toBeEnabled();
});
