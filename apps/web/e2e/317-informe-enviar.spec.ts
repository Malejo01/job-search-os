import { expect, test, type Page } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import {
  INFORME_URL,
  clearReportsOf,
  makePdf,
  makePng,
  reportsOf,
  seedDraft,
} from "./informe-helpers";

/**
 * Flujo 317 (R29-03): enviar el informe. Antes de enviar se valida (sin ítems, o un ítem vacío, no pasa); la
 * confirmación muestra el resumen («2 ítems, 1 captura, 1 documento»); «Volver» deja el borrador como estaba; al
 * confirmar queda `enviado` y congelado, Afi festeja y la lista de enviados lo muestra. El aviso a los admins sale
 * por el envío simulado (sin `RESEND_API_KEY`): acá solo se comprueba que el envío no falla por eso. Datos inventados.
 */
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

async function abrir(page: Page) {
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await expect(page.getByTestId("informe-agregar")).toBeVisible();
}

test("sin ítems no se envía y lo dice", async ({ page }) => {
  await abrir(page);
  await page.getByTestId("informe-enviar").click();
  await expect(page.getByTestId("informe-error-envio")).toContainText("Sumá al menos un ítem");
  await expect(page.getByTestId("informe-confirmar")).toBeHidden();
});

test("un ítem sin texto ni adjuntos no deja enviar y dice cuál es", async ({ page }) => {
  await seedDraft(["Ítem con texto 317", ""]);
  await abrir(page);
  await expect(page.getByTestId("informe-item-2")).toBeVisible();
  await page.getByTestId("informe-enviar").click();
  await expect(page.getByTestId("informe-error-envio")).toContainText(
    "El ítem 2 no tiene texto ni adjuntos",
  );
  await expect(page.getByTestId("informe-confirmar")).toBeHidden();
  expect((await reportsOf())[0]?.status).toBe("borrador");
});

test("la confirmación muestra el resumen; «Volver» no cambia nada y confirmar envía y congela", async ({
  page,
}) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  const uno = page.getByTestId("informe-item-1");
  await uno.getByTestId("informe-mensaje").fill("Primer ítem ficticio 317");
  await uno.getByTestId("informe-archivo").setInputFiles({
    name: "captura-317.png",
    mimeType: "image/png",
    buffer: makePng(200, 120),
  });
  await expect(uno.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("informe-agregar").click();
  const dos = page.getByTestId("informe-item-2");
  await dos.getByTestId("informe-mensaje").fill("Segundo ítem ficticio 317");
  await dos.getByTestId("informe-archivo").setInputFiles({
    name: "nota-317.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });
  await expect(dos.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 15_000 });

  // Volver: el borrador queda como estaba
  await page.getByTestId("informe-enviar").click();
  const dialog = page.getByTestId("informe-confirmar");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("informe-resumen")).toContainText(
    "2 ítems, 1 captura, 1 documento",
  );
  await dialog.getByRole("button", { name: "Volver" }).click();
  await expect(dialog).toBeHidden();
  expect((await reportsOf())[0]?.status).toBe("borrador");

  // Confirmar
  await page.getByTestId("informe-enviar").click();
  await page.getByTestId("informe-confirmar-si").click();
  await expect(page.getByTestId("informe-enviado")).toBeVisible();
  await expect(page.getByTestId("informe-afi-enviado-texto")).toHaveText(
    "¡Gracias! Lo voy a leer con mucha atención.",
  );
  await expect(page.getByTestId("informe-enviado")).toContainText(
    "Mandaste 2 ítems, 1 captura, 1 documento",
  );
  // Un solo Afi por pantalla: se fue el que explicaba
  await expect(page.getByTestId("informe-afi")).toHaveCount(0);

  const [report] = await reportsOf();
  expect(report?.status).toBe("enviado");
  expect(report?.sentAt).not.toBeNull();
  expect(report?.items.map((i) => i.message)).toEqual([
    "Primer ítem ficticio 317",
    "Segundo ítem ficticio 317",
  ]);
  expect(report?.attachments).toHaveLength(2);

  // Congelado: ya no se suben archivos a sus ítems
  const respuesta = await page.request.post("/api/feedback-files", {
    multipart: {
      itemId: report!.items[0]!.id,
      file: { name: "tarde.pdf", mimeType: "application/pdf", buffer: makePdf() },
    },
  });
  expect((await respuesta.json()).ok).toBe(false);
  expect((await reportsOf())[0]?.attachments).toHaveLength(2);
});

test("después de enviar, la pantalla arranca otro informe vacío y lista el enviado", async ({
  page,
}) => {
  await seedDraft(["Ítem ficticio 317 para enviar"]);
  await abrir(page);
  await page.getByTestId("informe-enviar").click();
  await page.getByTestId("informe-confirmar-si").click();
  await expect(page.getByTestId("informe-enviado")).toBeVisible();

  await page.getByRole("button", { name: "Armar otro informe" }).click();
  await expect(page.getByTestId("informe-item-1")).toHaveCount(0);
  await expect(page.getByTestId("informe-afi")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("informe-item-1")).toHaveCount(0);
  const lista = page.getByTestId("informe-lista-enviados");
  await expect(lista).toContainText("1 ítem, 0 capturas, 0 documentos");
  await expect(lista).toContainText("Enviado");

  // Y se puede armar uno nuevo: un segundo borrador, separado del enviado
  await page.getByTestId("informe-agregar").click();
  await expect(page.getByTestId("informe-item-1")).toBeVisible();
  const reports = await reportsOf(E2E_B_USER_ID);
  expect(reports.map((r) => r.status).sort()).toEqual(["borrador", "enviado"]);
});
