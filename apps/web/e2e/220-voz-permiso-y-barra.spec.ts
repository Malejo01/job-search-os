import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import { FAKE_MIC, OPERA_GX_UA, cleanB, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 220 (R25-06): el permiso y la barra de audio. Con el user agent de Opera GX (que no tiene dictado propio) el
 * micrófono pasa por la grabación. Con el micrófono falso de Chromium: el estado pasa a «Escuchando…», el contador
 * corre y el nivel de la barra sube por encima de cero con la voz (el dispositivo falso da un tono). «Cancelar»
 * vuelve al inicio y libera el micrófono.
 */
test.use({ ...FAKE_MIC, userAgent: OPERA_GX_UA });
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 220");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("pide el micrófono, escucha y la barra se mueve", async ({ page }) => {
  await openInterview(page, sessionId);
  const boton = page.getByTestId("voice-boton");
  await expect(boton).toBeVisible();
  await expect(boton).toHaveAttribute("aria-pressed", "false");
  // En Opera GX el aviso habla del servidor y de Gemini
  await expect(page.getByTestId("voice-input")).toContainText("Gemini");

  await boton.click();
  await expect(boton).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("voice-escuchando")).toContainText("Escuchando");
  await expect(page.getByRole("timer")).toBeVisible();
  // El tono del dispositivo falso hace subir el nivel por encima de cero
  await expect
    .poll(async () => Number(await page.getByTestId("voice-nivel").getAttribute("data-level")), {
      timeout: 8_000,
    })
    .toBeGreaterThan(0);
  // Los dos botones de salida a 44 px o más
  for (const id of ["voice-listo", "voice-cancelar"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  await page.getByTestId("voice-cancelar").click();
  await expect(boton).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("voice-escuchando")).toHaveCount(0);
  await expect(page.getByTestId("interview-answer")).toHaveValue("");
});
