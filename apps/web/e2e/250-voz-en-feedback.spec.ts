import { expect, test } from "@playwright/test";
import { E2E_B_USER_ID, loginAsSecondUser, removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  FAKE_TRANSCRIPTION_SHORT,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  cleanB,
  prepareB,
} from "./voz-helpers";
import { clearFeedbackOf, feedbackOf } from "./recorrido-helpers";

/**
 * Flujo 250 (pedido de Ani, 24/11): el modal «¿Algo no anduvo?» tiene el botón para dictar el mensaje. Camino
 * «grabación + servidor» (Opera GX) con el modelo simulado: lo dictado cae en «Tu mensaje», sumado a lo escrito,
 * nunca se envía solo, y al tocar «Enviar» llega como comentario. Datos inventados.
 */
test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
test.use({ ...FAKE_MIC, userAgent: OPERA_GX_UA });
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await prepareB("Simulación ficticia de voz 250");
  await clearFeedbackOf();
});
test.afterAll(async () => {
  await clearFeedbackOf();
  await cleanB();
  await removeSecondUser();
});

test("dictar en el modal de feedback deja el texto en el mensaje y se envía como comentario", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  const campo = dialog.getByLabel("Tu mensaje");
  await campo.fill("Hola");

  const boton = dialog.getByTestId("voice-boton");
  await expect(boton).toBeVisible();
  await boton.click();
  await expect(dialog.getByTestId("voice-escuchando")).toBeVisible();
  await page.waitForTimeout(1_500); // el grabador entrega trozos cada 1 s
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/transcribe")),
    dialog.getByTestId("voice-listo").click(),
  ]);
  expect(response.status()).toBe(200);

  await expect(campo).toHaveValue(`Hola ${FAKE_TRANSCRIPTION_SHORT}`);
  // Nunca se envía solo: el modal sigue abierto y no hay comentario guardado
  await expect(dialog).toBeVisible();
  expect(await feedbackOf(E2E_B_USER_ID)).toHaveLength(0);

  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
  const [row] = await feedbackOf(E2E_B_USER_ID);
  expect(row?.message).toContain(`Hola ${FAKE_TRANSCRIPTION_SHORT}`);
});
