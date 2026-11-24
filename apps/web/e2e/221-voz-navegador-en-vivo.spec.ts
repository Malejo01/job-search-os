import { expect, test } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import { FAKE_MIC, cleanB, installRecognition, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 221 (R25-06): camino «navegador» (Chrome, Edge, Safari) con un reconocimiento simulado. El parcial se ve
 * en gris y el final en negro dentro de la vista previa; al tocar «Listo» el texto se suma a lo que ya había en
 * el campo (no lo pisa) y la respuesta NO se envía sola.
 */
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 221");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

test("el texto en vivo va a la vista previa y «Listo» lo suma al campo sin enviar", async ({
  page,
}) => {
  await installRecognition(page, "live");
  await openInterview(page, sessionId);
  const campo = page.getByTestId("interview-answer");
  await campo.fill("En mi último trabajo");

  await page.getByTestId("voice-boton").click();
  const previa = page.getByTestId("voice-vista-previa");
  // Parcial: gris. El campo todavía no cambió
  await expect(
    previa.locator("span.text-fg-subtle", { hasText: "Trabajé con datos" }),
  ).toBeVisible();
  await expect(campo).toHaveValue("En mi último trabajo");
  // Final: negro
  await page.evaluate(() => (window as unknown as { __recFinal: () => void }).__recFinal());
  await expect(
    previa.locator("span.text-fg", { hasText: "Trabajé con datos de ventas" }),
  ).toBeVisible();

  await page.getByTestId("voice-listo").click();
  await expect(campo).toHaveValue("En mi último trabajo Trabajé con datos de ventas");
  expect(await page.evaluate(() => (window as unknown as { __lang: string }).__lang)).toBe("es-AR");
  // Nunca se envía solo
  await expect(page.getByTestId("interview-feedback")).toHaveCount(0);
  await expect(page.getByTestId("interview-send")).toBeEnabled();
});
