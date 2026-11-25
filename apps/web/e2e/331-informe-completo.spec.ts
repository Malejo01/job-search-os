import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { afiShot, CAPTURAS_R29 } from "./afi-v2-helpers";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, login, loginAsSecondUser, removeSecondUser } from "./helpers";
import { INFORME_URL, clearReportsOf, makePdf, reportsOf } from "./informe-helpers";
import { reach } from "./teclado-helpers";
import {
  FAKE_MIC,
  ensureOffUser,
  installRecognition,
  loginAsOffUser,
  removeOffUser,
} from "./voz-helpers";

/**
 * Flujo 331 (R29-07): el informe de revisión de punta a punta. La tester (persona B) arma tres ítems en el celular:
 * uno dictado (reconocimiento simulado), uno con dos capturas pegadas (imágenes dibujadas en la propia página y
 * pegadas con `ClipboardEvent`) y uno con un PDF mínimo; lo recorre con el teclado, lo envía y lo ve enviado. La
 * admin (la persona del seed) lo ve en `/admin/informes`, abre una miniatura, cambia el estado de un ítem y exporta
 * el `.md`. Una persona común recibe 404 en la lista, el detalle, la exportación y los archivos. A 390 y 360 px, sin
 * scroll horizontal y con axe sin violaciones serias. Capturas en `ops/capturas/r29/informe/` (la carpeta no se
 * versiona). Todo inventado; ningún modelo (reconocimiento simulado y `LLM_DEMO=1`).
 */
test.use(FAKE_MIC);
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const OUT = join(CAPTURAS_R29, "informe");
const TEXTO_DICTADO = "Trabajé con datos de ventas";

test.beforeAll(async () => {
  await ensureSecondUser();
  await ensureOffUser();
  await clearReportsOf();
});
test.afterAll(async () => {
  await clearReportsOf().catch(() => {});
  await removeOffUser().catch(() => {});
  await removeSecondUser().catch(() => {});
});

let reportId = "";

async function sinScrollHorizontal(page: Page): Promise<void> {
  const { ancho, scroll } = await page.evaluate(() => ({
    ancho: window.innerWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(ancho);
}

/** axe sin violaciones serias ni críticas (las menores no frenan este flujo). */
async function axeSerias(page: Page): Promise<string[]> {
  const { violations } = await axeSummary(page);
  return violations.filter((v) => /\((serious|critical)\)/.test(v));
}

type ConImagen = { __crearImagen: (color: string) => Promise<File> };

test("la tester arma tres ítems (dictado, dos capturas pegadas, un PDF), los recorre con el teclado y los envía", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installRecognition(page, "live");
  await page.addInitScript(() => {
    (window as unknown as ConImagen).__crearImagen = async (color: string) => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 200;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 320, 200);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      return new File([blob], `pegada-${color.slice(1)}.png`, { type: "image/png" });
    };
  });
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await expect(page.getByTestId("informe-agregar")).toBeVisible();
  await afiShot(page, OUT, "01-vacio", 390, "claro", { fullPage: true });

  // Ítem 1: escrito y dictado
  await page.getByTestId("informe-agregar").click();
  const uno = page.getByTestId("informe-item-1");
  await expect(uno).toBeVisible();
  const campoUno = uno.getByTestId("informe-mensaje");
  await campoUno.fill("Ítem 1 ficticio 331: al abrir Hoy");
  await uno.getByTestId("voice-boton").click();
  // El parcial llega a los 50 ms: esperarlo, así el final no queda pisado por él
  await expect(uno.getByTestId("voice-vista-previa")).toContainText("Trabajé con datos");
  await page.evaluate(() => (window as unknown as { __recFinal: () => void }).__recFinal());
  await uno.getByTestId("voice-listo").click();
  await expect(campoUno).toHaveValue(`Ítem 1 ficticio 331: al abrir Hoy ${TEXTO_DICTADO}`);

  // Ítem 2: dos capturas pegadas con Ctrl+V
  await page.getByTestId("informe-agregar").click();
  const dos = page.getByTestId("informe-item-2");
  await expect(dos).toBeVisible();
  await dos.getByTestId("informe-mensaje").fill("Ítem 2 ficticio 331: dos capturas");
  for (const [n, color] of [
    [1, "#3366cc"],
    [2, "#cc6633"],
  ] as const) {
    await dos.getByTestId("informe-mensaje").focus();
    const prevented = await page.evaluate(async (c) => {
      const file = await (window as unknown as ConImagen).__crearImagen(c);
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement!.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, color);
    expect(prevented).toBe(true);
    await expect(dos.getByTestId("informe-adjunto")).toHaveCount(n, { timeout: 20_000 });
  }

  // Ítem 3: un PDF mínimo
  await page.getByTestId("informe-agregar").click();
  const tres = page.getByTestId("informe-item-3");
  await expect(tres).toBeVisible();
  await tres.getByTestId("informe-mensaje").fill("Ítem 3 ficticio 331: un PDF");
  await tres.getByTestId("informe-archivo").setInputFiles({
    name: "nota-331.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });
  await expect(tres.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });

  // El borrador quedó guardado con lo dictado, las dos imágenes (WebP) y el PDF
  await expect.poll(async () => (await reportsOf())[0]?.items.length, { timeout: 15_000 }).toBe(3);
  const [borrador] = await reportsOf();
  expect(borrador?.status).toBe("borrador");
  expect(borrador?.attachments.filter((a) => a.kind === "image")).toHaveLength(2);
  expect(borrador?.attachments.every((a) => a.mime === "image/webp" || a.kind === "pdf")).toBe(
    true,
  );
  expect(borrador?.attachments.filter((a) => a.kind === "pdf")).toHaveLength(1);

  await sinScrollHorizontal(page);
  expect(await axeSerias(page)).toEqual([]);
  await afiShot(page, OUT, "02-armado", 390, "claro", { fullPage: true });

  // Teclado: el botón de enviar se alcanza con Tab, con foco visible, y abre el diálogo
  await reach(page, page.getByTestId("informe-enviar"), "Enviar informe");
  await page.keyboard.press("Enter");
  const dialog = page.getByTestId("informe-confirmar");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("informe-resumen")).toContainText(
    "3 ítems, 2 capturas, 1 documento",
  );
  await sinScrollHorizontal(page);
  expect(await axeSerias(page)).toEqual([]);
  await afiShot(page, OUT, "03-confirmar", 390, "claro");
  await page.getByTestId("informe-confirmar-si").click();
  await expect(page.getByTestId("informe-enviado")).toBeVisible();
  await expect(page.getByTestId("informe-enviado")).toContainText(
    "Mandaste 3 ítems, 2 capturas, 1 documento",
  );
  await expect(page.getByTestId("informe-afi-enviado")).toBeVisible();
  await afiShot(page, OUT, "04-enviado", 390, "claro", { fullPage: true });

  const [enviado] = await reportsOf();
  expect(enviado?.status).toBe("enviado");
  expect(enviado?.items.map((i) => i.message)).toEqual([
    `Ítem 1 ficticio 331: al abrir Hoy ${TEXTO_DICTADO}`,
    "Ítem 2 ficticio 331: dos capturas",
    "Ítem 3 ficticio 331: un PDF",
  ]);
  reportId = enviado!.id;
});

test("la pantalla de la tester, ya enviado, a 360 px: sin scroll horizontal y axe sin violaciones serias", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await expect(page.getByTestId("informe-lista-enviados")).toContainText(
    "3 ítems, 2 capturas, 1 documento",
  );
  await sinScrollHorizontal(page);
  expect(await axeSerias(page)).toEqual([]);
  await afiShot(page, OUT, "05-lista-enviados", 360, "claro", { fullPage: true });
});

for (const ancho of [390, 360] as const) {
  test(`la admin ve el informe a ${ancho} px, abre una miniatura, cambia un estado y exporta el .md`, async ({
    page,
  }) => {
    // Como el 322: sin ADMIN_EMAILS la cuenta del e2e no es admin (corre en el CI)
    test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");
    await page.setViewportSize({ width: ancho, height: 844 });
    await login(page);
    await page.goto("/admin/informes");
    const fila = page.getByTestId("informe-fila");
    await expect(fila).toHaveCount(1);
    await expect(fila.first()).toContainText("3 ítems");
    await expect(fila.first()).toContainText("2 capturas");
    await expect(fila.first()).toContainText("1 documento");
    await sinScrollHorizontal(page);
    expect(await axeSerias(page)).toEqual([]);
    await afiShot(page, OUT, "06-admin-lista", ancho, "claro", { fullPage: true });

    await fila.first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/informes/${reportId}$`));
    const items = page.getByTestId("informe-item");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0).getByTestId("informe-mensaje")).toContainText(TEXTO_DICTADO);
    await sinScrollHorizontal(page);
    expect(await axeSerias(page)).toEqual([]);
    await afiShot(page, OUT, "07-admin-detalle", ancho, "claro", { fullPage: true });

    // Miniatura: dos en el ítem 2; se abre grande en otra pestaña, con sesión
    const miniaturas = items.nth(1).getByTestId("informe-capturas").locator("a");
    await expect(miniaturas).toHaveCount(2);
    const img = miniaturas.first().locator("img");
    await expect
      .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    const [popup] = await Promise.all([page.waitForEvent("popup"), miniaturas.first().click()]);
    await popup.waitForLoadState("load");
    expect(popup.url()).toContain("/api/feedback-files/");
    await expect(popup.locator("img")).toBeVisible();
    await popup.close();
    // El documento del ítem 3 se baja como adjunto
    const doc = items.nth(2).getByTestId("informe-documentos").locator("a");
    const href = await doc.getAttribute("href");
    const bajada = await page.request.get(href!);
    expect(bajada.headers()["content-disposition"]).toMatch(/^attachment;/);

    // Cambia el estado del primer ítem (en el segundo ancho ya quedó «visto»: se vuelve a «nuevo»)
    const primero = items.nth(0);
    const antes = ancho === 390 ? "Marcar como visto" : "Marcar como nuevo";
    const despues = ancho === 390 ? "Visto" : "Nuevo";
    await primero.getByRole("button", { name: antes }).click();
    await expect(page.getByTestId("informe-item").nth(0)).toContainText(despues);

    // Exporta el .md
    const exp = await page.request.get(`/admin/informes/${reportId}/export`);
    expect(exp.status()).toBe(200);
    expect(exp.headers()["content-type"]).toContain("text/markdown");
    expect(exp.headers()["content-disposition"]).toMatch(/^attachment;/);
    const md = await exp.text();
    expect(md).toContain(TEXTO_DICTADO);
    expect(md).toContain("Ítem 3 ficticio 331: un PDF");
    expect((md.match(/\/api\/feedback-files\//g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(md).not.toContain("pgb:");
    expect(md).not.toMatch(/<script/i);
  });
}

test("una persona común recibe 404 en la lista, el detalle, la exportación y los archivos", async ({
  page,
}) => {
  const [informe] = await reportsOf();
  const archivoId = informe!.attachments[0]!.id;
  await loginAsOffUser(page);
  for (const ruta of ["/admin/informes", `/admin/informes/${reportId}`]) {
    const res = await page.goto(ruta);
    expect(res?.status(), ruta).toBe(404);
  }
  const exp = await page.request.get(`/admin/informes/${reportId}/export`, {
    failOnStatusCode: false,
  });
  expect(exp.status()).toBe(404);
  const archivo = await page.request.get(`/api/feedback-files/${archivoId}`, {
    failOnStatusCode: false,
  });
  expect(archivo.status()).toBe(404);
  // Tampoco ve la pantalla de la tester ni puede subir
  const subida = await page.request.post("/api/feedback-files", {
    multipart: {
      itemId: informe!.items[0]!.id,
      file: { name: "x.pdf", mimeType: "application/pdf", buffer: makePdf() },
    },
    headers: { origin: new URL(page.url()).origin },
    failOnStatusCode: false,
  });
  expect(subida.status()).toBe(404);
});
