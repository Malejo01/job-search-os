import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import {
  FAKE_MIC,
  FAKE_TRANSCRIPTION_SHORT,
  OPERA_GX_UA,
  SERVER_MODE_ON,
  installRecognition,
} from "./voz-helpers";
import { INFORME_URL, clearReportsOf, reportsOf } from "./informe-helpers";

/**
 * Flujo 316 (R29-03): dictar dentro de un ítem del informe, con el reconocimiento y el transcriptor simulados (ningún
 * modelo real). Varias grabaciones seguidas se suman con `joinDictated` sin pisar lo escrito, lo dictado nunca se
 * envía solo y queda en el borrador. Datos inventados.
 */
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.beforeEach(async () => {
  await clearReportsOf();
});
test.afterAll(async () => {
  await clearReportsOf();
  await removeSecondUser();
});

async function abrirConItem(page: Page) {
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await page.getByTestId("informe-agregar").click();
  const item = page.getByTestId("informe-item-1");
  await expect(item).toBeVisible();
  return item;
}

test.describe("navegador con dictado en vivo (Chrome)", () => {
  test("dos dictados seguidos se suman a lo escrito sin pisarlo y quedan guardados", async ({
    page,
  }) => {
    await installRecognition(page, "live");
    const item = await abrirConItem(page);
    const campo = item.getByTestId("informe-mensaje");
    await campo.fill("Antes de dictar");

    for (let vez = 1; vez <= 2; vez++) {
      await item.getByTestId("voice-boton").click();
      // El parcial llega a los 50 ms: esperarlo, así el final no queda pisado por él
      await expect(item.getByTestId("voice-vista-previa")).toContainText("Trabajé con datos");
      await page.evaluate(() => (window as unknown as { __recFinal: () => void }).__recFinal());
      await item.getByTestId("voice-listo").click();
      const esperado = `Antes de dictar${" Trabajé con datos de ventas".repeat(vez)}`;
      await expect(campo).toHaveValue(esperado);
    }

    // Nunca se envía solo: el informe sigue en borrador, y lo dictado se guarda como cualquier texto
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(async () => (await reportsOf())[0]?.items[0]?.message)
      .toBe("Antes de dictar Trabajé con datos de ventas Trabajé con datos de ventas");
    expect((await reportsOf())[0]?.status).toBe("borrador");
  });
});

test.describe("navegador que graba y transcribe en el servidor (Opera GX)", () => {
  test.skip(!SERVER_MODE_ON, "necesita VOICE_SERVER_TRANSCRIBE=testers en el servidor de e2e");
  test.use({ userAgent: OPERA_GX_UA });

  test("la grabación se transcribe con el modelo simulado y se suma al texto", async ({ page }) => {
    const item = await abrirConItem(page);
    const campo = item.getByTestId("informe-mensaje");
    await campo.fill("Hola");
    await item.getByTestId("voice-boton").click();
    await expect(item.getByTestId("voice-escuchando")).toBeVisible();
    await page.waitForTimeout(1_500); // el grabador entrega trozos cada 1 s
    const [respuesta] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/transcribe")),
      item.getByTestId("voice-listo").click(),
    ]);
    expect(respuesta.status()).toBe(200);
    await expect(campo).toHaveValue(`Hola ${FAKE_TRANSCRIPTION_SHORT}`);
  });
});
