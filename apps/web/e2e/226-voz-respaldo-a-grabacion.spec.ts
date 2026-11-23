import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import {
  FAKE_TRANSCRIPTION_MEDIUM,
  FAKE_TRANSCRIPTION_SHORT,
  SERVER_MODE_ON,
  cleanB,
  fakeMicWithTone,
  installRecognition,
  openInterview,
  prepareB,
} from "./voz-helpers";

/**
 * Flujo 226 (R25-06): el respaldo a la grabación. En un navegador que parece tener dictado (Chrome) pero el
 * servicio falla (`network`) o no devuelve nada en 4 s con voz, el componente pasa solo a grabar, sin perder lo
 * hablado, y «Listo» lo transcribe en el servidor.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use(fakeMicWithTone());
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 226");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("el reconocimiento falla con «network»: pasa a grabar y transcribe en el servidor", async ({
  page,
}) => {
  await installRecognition(page, "network");
  await openInterview(page, sessionId);
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-escuchando")).toBeVisible();
  // Sigue escuchando (ahora grabando) y no hay vista previa del navegador
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId("voice-boton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("voice-vista-previa")).toHaveCount(0);
  await page.getByTestId("voice-listo").click();
  await expect(page.getByTestId("interview-answer")).toHaveValue(FAKE_TRANSCRIPTION_SHORT);
  await expect(page.getByTestId("interview-feedback")).toHaveCount(0);
});

test("4 segundos sin resultado y con voz: pasa a grabar", async ({ page }) => {
  test.setTimeout(60_000);
  await installRecognition(page, "mute");
  await openInterview(page, sessionId);
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-vista-previa")).toBeVisible();
  // Con el tono del micrófono falso y sin nada del navegador, a los ~4 s se cambia al camino de grabación
  await expect(page.getByTestId("voice-vista-previa")).toHaveCount(0, { timeout: 12_000 });
  await expect(page.getByTestId("voice-boton")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("voice-listo").click();
  // Gana la transcripción del servidor. Según cuánto duró (≤5 s o ≤30 s) el fake devuelve la corta o la media;
  // el reconocimiento simulado «mute» nunca dice nada, así que cualquiera de las dos viene del servidor
  const campo = page.getByTestId("interview-answer");
  await expect(campo).toHaveValue(/^Trabajé tres años /);
  const value = await campo.inputValue();
  expect([FAKE_TRANSCRIPTION_SHORT, FAKE_TRANSCRIPTION_MEDIUM]).toContain(value);
});
