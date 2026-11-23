import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  FAKE_TRANSCRIPTION_SHORT,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  openInterview,
  prepareB,
} from "./voz-helpers";

/**
 * Flujo 222 (R25-06): camino «grabación + servidor» (Opera GX, Brave, Firefox) con el modelo simulado. La persona B es
 * tester, así que el servidor de e2e (`VOICE_SERVER_TRANSCRIBE=testers`) transcribe. Con «Listo» la grabación sale
 * a `/api/transcribe` como `multipart`, se ve «Transcribiendo…» y el texto fijo del fake cae en el campo, sumado a
 * lo que había. Nada se envía solo.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use({ ...FAKE_MIC, userAgent: OPERA_GX_UA });
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 222");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("graba, transcribe en el servidor y deja el texto en el campo", async ({ page }) => {
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Hola");
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-escuchando")).toBeVisible();
  // Mientras se graba no hay texto en vivo (solo la barra)
  await expect(page.getByTestId("voice-vista-previa")).toHaveCount(0);
  await page.waitForTimeout(1_500); // el grabador entrega trozos cada 1 s

  // El cuerpo del multipart armado con FormData no se puede leer desde Playwright: se mira el método, el tipo y el 200
  const [request, response] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/transcribe")),
    page.waitForResponse((r) => r.url().includes("/api/transcribe")),
    page.getByTestId("voice-listo").click(),
  ]);
  expect(request.method()).toBe("POST");
  expect(request.headers()["content-type"]).toContain("multipart/form-data");
  expect(response.status()).toBe(200);

  await expect(campo).toHaveValue(`Hola ${FAKE_TRANSCRIPTION_SHORT}`);
  await expect(page.getByTestId("voice-transcribiendo")).toHaveCount(0);
  // Nunca se envía solo
  await expect(page.getByTestId("interview-feedback")).toHaveCount(0);
});
