import { expect, test, type Page } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import {
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  installRecognition,
  openInterview,
  prepareB,
} from "./voz-helpers";

/**
 * Flujo 227 (R25-06): permiso denegado y sin micrófono. Sin las flags de micrófono falso (a propósito): el
 * `getUserMedia` se reemplaza para que falle como lo hace cada navegador. El mensaje dice qué hacer según el
 * navegador (en Opera GX, el candado de la barra de direcciones) y el campo sigue andando. «Página no segura»
 * no se puede simular en localhost: lo cubre el unit de `voiceErrorMessage`.
 */
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 227");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

async function failGetUserMedia(page: Page, name: string): Promise<void> {
  await page.addInitScript((errorName) => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("simulado", errorName)),
      },
    });
  }, name);
}

async function expectTypingStillWorks(page: Page): Promise<void> {
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Respuesta escrita a mano");
  await expect(campo).toHaveValue("Respuesta escrita a mano");
  await expect(page.getByTestId("interview-send")).toBeEnabled();
}

test("Chrome: permiso denegado muestra cómo habilitarlo", async ({ page }) => {
  await installRecognition(page, "live");
  await failGetUserMedia(page, "NotAllowedError");
  await openInterview(page, sessionId);
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-error")).toContainText("no nos dejó usar el micrófono");
  await expect(page.getByTestId("voice-error")).toContainText("candado");
  await expect(page.getByTestId("voice-boton")).toHaveAttribute("aria-pressed", "false");
  await expectTypingStillWorks(page);
});

test("Chrome: sin micrófono conectado lo dice", async ({ page }) => {
  await installRecognition(page, "live");
  await failGetUserMedia(page, "NotFoundError");
  await openInterview(page, sessionId);
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-error")).toContainText("No encontramos un micrófono");
  await expectTypingStillWorks(page);
});

test.describe("Opera GX", () => {
  test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
  test.use({ userAgent: OPERA_GX_UA });

  test("permiso denegado apunta al candado y a «Configuración del sitio»", async ({ page }) => {
    await failGetUserMedia(page, "NotAllowedError");
    await openInterview(page, sessionId);
    await page.getByTestId("voice-boton").click();
    const error = page.getByTestId("voice-error");
    await expect(error).toContainText("candado");
    await expect(error).toContainText("Configuración del sitio");
    await expectTypingStillWorks(page);
  });
});
