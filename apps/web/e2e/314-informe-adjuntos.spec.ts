import { expect, test, type Page } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import {
  E2E_B_USER_ID,
  ensureSecondUser,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";
import { INFORME_URL, clearReportsOf, makePdf, makePng, reportsOf } from "./informe-helpers";

/**
 * Flujo 314 (R29-03): los adjuntos del ítem. Elegir archivos: la imagen se pasa a WebP en el navegador (lado mayor
 * 2.000 px) y queda con su miniatura; el PDF sube tal cual; un documento de más de 4 MB se rechaza antes de subir;
 * SVG, HTML y archivos que no son lo que dicen se rechazan; se puede quitar un adjunto y hay un máximo de 10 por
 * ítem. Los archivos se generan en el test. Datos inventados.
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
  await expect(page.getByTestId("informe-item-1")).toBeVisible();
  return page.getByTestId("informe-item-1");
}

const subidas = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/feedback-files")) seen.push(r.url());
  });
  return seen;
};

const blobsDe = async () => {
  const { db, close } = ownerDb();
  try {
    return await db
      .select({ id: s.blobFiles.id })
      .from(s.blobFiles)
      .where(eq(s.blobFiles.userId, E2E_B_USER_ID));
  } finally {
    await close();
  }
};

test("elegir una imagen grande: se achica a WebP de 2.000 px, queda con miniatura y se guarda como WebP", async ({
  page,
}) => {
  const item = await abrirConItem(page);
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "captura-ficticia.png",
    mimeType: "image/png",
    buffer: makePng(3000, 1500),
  });
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 20_000 });

  const miniatura = item.getByTestId("informe-adjunto").locator("img");
  await expect(miniatura).toBeVisible();
  await expect
    .poll(() => miniatura.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(2000);

  const [report] = await reportsOf();
  const [adjunto] = report!.attachments;
  expect(adjunto).toMatchObject({ kind: "image", mime: "image/webp", width: 2000, height: 1000 });
  expect(adjunto!.name).toBe("captura-ficticia.webp");
  expect(adjunto!.bytes).toBeLessThan(1.5 * 1024 * 1024);
  expect(await blobsDe()).toHaveLength(1);
});

test("un PDF sube tal cual, con su nombre y un link para abrirlo", async ({ page }) => {
  const item = await abrirConItem(page);
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "nota-ficticia.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });
  const adjunto = item.getByTestId("informe-adjunto");
  await expect(adjunto).toHaveCount(1, { timeout: 15_000 });
  await expect(adjunto.getByRole("link", { name: "nota-ficticia.pdf" })).toBeVisible();
  const [report] = await reportsOf();
  expect(report!.attachments[0]).toMatchObject({ kind: "pdf", mime: "application/pdf" });
});

test("un documento de más de 4 MB se rechaza antes de subir y no se manda ningún pedido", async ({
  page,
}) => {
  const item = await abrirConItem(page);
  const pedidos = subidas(page);
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "enorme-ficticio.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(5 * 1024 * 1024),
  });
  await expect(item.getByTestId("informe-aviso-adjunto")).toContainText(
    "Por ahora, documentos de hasta 4 MB",
  );
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(0);
  expect(pedidos).toHaveLength(0);
});

test("SVG, HTML y un «.png» que no es una imagen se rechazan con un aviso", async ({ page }) => {
  const item = await abrirConItem(page);
  const aviso = item.getByTestId("informe-aviso-adjunto");

  await item.getByTestId("informe-archivo").setInputFiles({
    name: "dibujo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
  });
  await expect(aviso).toContainText("Ese tipo de archivo no se puede adjuntar");

  await item.getByTestId("informe-archivo").setInputFiles({
    name: "pagina.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html><body>x</body></html>"),
  });
  await expect(aviso).toContainText("Ese tipo de archivo no se puede adjuntar");

  // Disfrazado: dice ser PNG pero es HTML. El navegador no lo puede leer como imagen
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "disfrazado.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html><body>no soy una imagen</body></html>"),
  });
  await expect(aviso).toContainText("No pudimos leer la imagen");
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(0);
  expect((await reportsOf())[0]!.attachments).toHaveLength(0);
});

test("quitar un adjunto lo borra de la lista, de la base y también el archivo", async ({
  page,
}) => {
  const item = await abrirConItem(page);
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "para-quitar.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 15_000 });
  expect(await blobsDe()).toHaveLength(1);

  await item.getByTestId("informe-quitar-adjunto").click();
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(0);
  expect((await reportsOf())[0]!.attachments).toHaveLength(0);
  expect(await blobsDe()).toHaveLength(0);
});

test("quitar un ítem con adjuntos borra también sus archivos", async ({ page }) => {
  const item = await abrirConItem(page);
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "se-va-con-el-item.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(),
  });
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(1, { timeout: 15_000 });
  await item.getByTestId("informe-quitar").click();
  await item.getByTestId("informe-quitar-si").click();
  await expect(page.getByTestId("informe-item-1")).toHaveCount(0);
  await expect.poll(async () => (await blobsDe()).length).toBe(0);
});

test("el máximo es de 10 adjuntos por ítem y avisa", async ({ page }) => {
  // Diez subidas una detrás de otra contra `next dev` en el CI: más margen que el resto
  test.setTimeout(150_000);
  const item = await abrirConItem(page);
  const archivos = Array.from({ length: 10 }, (_, n) => ({
    name: `adjunto-${n + 1}.pdf`,
    mimeType: "application/pdf",
    buffer: makePdf(n),
  }));
  await item.getByTestId("informe-archivo").setInputFiles(archivos);
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(10, { timeout: 100_000 });
  await expect(item.getByTestId("informe-elegir")).toBeDisabled();
  await expect(item).toContainText("máximo de 10 adjuntos");
  await item.getByTestId("informe-archivo").setInputFiles({
    name: "uno-mas.pdf",
    mimeType: "application/pdf",
    buffer: makePdf(11),
  });
  await expect(item.getByTestId("informe-adjunto")).toHaveCount(10);
});
