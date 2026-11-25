import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { INFORME_URL, clearReportsOf, reportsOf } from "./informe-helpers";

/**
 * Flujo 315 (R29-03): otras formas de sumar capturas. Pegar con Ctrl+V (una imagen del portapapeles se sube y un
 * texto se pega normal), soltar un archivo sobre la zona de adjuntos y «Capturar esta pantalla» con
 * `getDisplayMedia` (simulado en la página, sin pedir permisos reales) solo si el navegador lo tiene. Datos
 * inventados.
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

async function abrirConItem(page: Page) {
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await page.getByTestId("informe-agregar").click();
  const item = page.getByTestId("informe-item-1");
  await expect(item).toBeVisible();
  return item;
}

type ConImagen = { __crearImagen: () => Promise<File> };

/** Deja en la página una función que arma una imagen PNG dibujada ahí mismo, para pegarla o soltarla. */
async function instalarImagen(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as ConImagen).__crearImagen = async () => {
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = 200;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#3366cc";
      ctx.fillRect(0, 0, 320, 200);
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      return new File([blob], "pegada-ficticia.png", { type: "image/png" });
    };
  });
}

test("Ctrl+V con una imagen en el portapapeles la sube como adjunto", async ({ page }) => {
  await instalarImagen(page);
  const item = await abrirConItem(page);
  await item.getByTestId("informe-mensaje").focus();
  const prevented = await page.evaluate(async () => {
    const file = await (window as unknown as ConImagen).__crearImagen();
    const dt = new DataTransfer();
    dt.items.add(file);
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(true);
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });
  const [report] = await reportsOf();
  expect(report!.attachments[0]).toMatchObject({ kind: "image", mime: "image/webp" });
});

test("pegar texto se comporta como siempre: no se intercepta ni sube nada", async ({ page }) => {
  const item = await abrirConItem(page);
  await item.getByTestId("informe-mensaje").focus();
  const prevented = await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/plain", "texto pegado");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.waitForTimeout(500);
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(0);
});

test("soltar un archivo sobre la zona de adjuntos lo sube", async ({ page }) => {
  await instalarImagen(page);
  const item = await abrirConItem(page);
  const dt = await page.evaluateHandle(async () => {
    const file = await (window as unknown as ConImagen).__crearImagen();
    const data = new DataTransfer();
    data.items.add(file);
    return data;
  });
  await item.getByTestId("informe-adjuntos").dispatchEvent("dragover", { dataTransfer: dt });
  await item.getByTestId("informe-adjuntos").dispatchEvent("drop", { dataTransfer: dt });
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });
});

test("«Capturar esta pantalla» saca un cuadro y lo suma como imagen", async ({ page }) => {
  await page.addInitScript(() => {
    // Un `getDisplayMedia` de mentira: un lienzo que se dibuja solo, sin cartel de permiso
    navigator.mediaDevices.getDisplayMedia = async () => {
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext("2d")!;
      const draw = () => {
        ctx.fillStyle = "#228844";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(40, 40, 200, 80);
      };
      draw();
      setInterval(draw, 100);
      return c.captureStream(10);
    };
  });
  const item = await abrirConItem(page);
  await item.getByTestId("informe-capturar").click();
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });
  const [report] = await reportsOf();
  expect(report!.attachments[0]).toMatchObject({
    kind: "image",
    mime: "image/webp",
    width: 640,
    height: 360,
  });
});

test("sin `getDisplayMedia` (como en el celular) el botón de capturar no aparece", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: undefined,
      configurable: true,
    });
  });
  const item = await abrirConItem(page);
  await expect(item.getByTestId("informe-elegir")).toBeVisible();
  await expect(item.getByTestId("informe-capturar")).toHaveCount(0);
});
