import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  installRecognition,
  openInterview,
  prepareB,
} from "./voz-helpers";

/**
 * Flujo 223 (R25-06): «Cancelar» no deja texto. En el camino «navegador» descarta lo hablado y en el de
 * «grabación» no manda nada al servidor; en los dos el campo queda como estaba.
 */
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 223");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("navegador: cancelar descarta lo hablado", async ({ page }) => {
  await installRecognition(page, "live");
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("Texto previo");
  await page.getByTestId("voice-boton").click();
  await expect(page.getByTestId("voice-vista-previa")).toContainText("Trabajé con datos");
  await page.getByTestId("voice-cancelar").click();
  await expect(page.getByTestId("voice-boton")).toHaveAttribute("aria-pressed", "false");
  await expect(campo).toHaveValue("Texto previo");
  await expect(page.getByTestId("voice-vista-previa")).toHaveCount(0);
});

test.describe("grabación", () => {
  test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
  test.use({ userAgent: OPERA_GX_UA });

  test("cancelar no manda el audio ni deja texto", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/transcribe")) calls.push(r.method());
    });
    await openInterview(page, sessionId);
    const campo = page.getByTestId("interview-answer");
    await campo.fill("Texto previo");
    await page.getByTestId("voice-boton").click();
    await expect(page.getByTestId("voice-escuchando")).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.getByTestId("voice-cancelar").click();
    await expect(page.getByTestId("voice-boton")).toHaveAttribute("aria-pressed", "false");
    await page.waitForTimeout(800);
    expect(calls).toEqual([]);
    await expect(campo).toHaveValue("Texto previo");
  });
});
