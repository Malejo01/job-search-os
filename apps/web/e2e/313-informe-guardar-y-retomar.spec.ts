import { expect, test, type Page } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { INFORME_URL, clearReportsOf, reportsOf } from "./informe-helpers";

/**
 * Flujo 313 (R29-03): el borrador del informe vive en la base. Se guarda solo (cada 10 s, solo si cambió, y al salir),
 * se puede retomar recargando, un error de guardado se ve sin perder el texto y se pueden quitar ítems. Datos
 * inventados.
 */
test.use({ viewport: { width: 390, height: 900 } });
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

const estado = (page: Page) => page.getByTestId("informe-estado");

async function abrir(page: Page) {
  await loginAsSecondUser(page);
  await page.goto(INFORME_URL);
  await expect(page.getByTestId("informe-agregar")).toBeVisible();
}

/** Lo que dispara el navegador al esconder la pestaña: el editor guarda sin esperar los 10 s. */
async function esconderPestaña(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

const mensajeEnBase = async () => (await reportsOf(E2E_B_USER_ID))[0]?.items[0]?.message ?? null;

test("agregar un ítem y escribir: se guarda solo a los 10 s y vuelve al recargar", async ({
  page,
}) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  const item = page.getByTestId("informe-item-1");
  await expect(item).toBeVisible();
  // El ítem ya existe en la base (así los adjuntos tienen a qué colgarse)
  expect((await reportsOf())[0]?.status).toBe("borrador");

  const texto = "Texto ficticio del informe 313: la lista se ve rara en el celular.";
  await item.getByTestId("informe-mensaje").fill(texto);
  await expect(estado(page)).toHaveAttribute("data-estado", "unsaved");

  // A los 10 s guarda sin que nadie toque nada
  await expect.poll(mensajeEnBase, { timeout: 20_000, intervals: [1_000] }).toBe(texto);
  await expect(estado(page)).toHaveAttribute("data-estado", "saved");
  await expect(estado(page)).toContainText("Guardado a las");

  await page.reload();
  await expect(page.getByTestId("informe-item-1").getByTestId("informe-mensaje")).toHaveValue(
    texto,
  );
  await expect(page.getByTestId("informe-item-2")).toHaveCount(0);
});

test("al esconder la pestaña guarda lo que cambió sin esperar los 10 s", async ({ page }) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  const texto = "Texto ficticio 313 guardado al salir";
  await page.getByTestId("informe-item-1").getByTestId("informe-mensaje").fill(texto);
  await esconderPestaña(page);
  await expect.poll(mensajeEnBase, { timeout: 5_000, intervals: [250] }).toBe(texto);
});

test("sin cambios no manda nada: ningún pedido al servidor mientras no se toca el texto", async ({
  page,
}) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  await page.getByTestId("informe-item-1").getByTestId("informe-mensaje").fill("Algo ficticio");
  await esconderPestaña(page);
  await expect(estado(page)).toHaveAttribute("data-estado", "saved");

  let pedidos = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.headers()["next-action"]) pedidos++;
  });
  await page.waitForTimeout(12_000); // más de un ciclo de 10 s
  await esconderPestaña(page);
  await page.waitForTimeout(500);
  expect(pedidos).toBe(0);
});

test("pantalla y tipo también se guardan y se retoman otro día", async ({ page }) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  const item = page.getByTestId("informe-item-1");
  await item.getByLabel("Pantalla").selectOption("/hoy");
  await item.getByLabel("Tipo de comentario").selectOption("idea");
  await item.getByTestId("informe-mensaje").fill("Idea ficticia 313");
  await esconderPestaña(page);
  await expect(estado(page)).toHaveAttribute("data-estado", "saved");

  await page.reload();
  const again = page.getByTestId("informe-item-1");
  await expect(again.getByLabel("Pantalla")).toHaveValue("/hoy");
  await expect(again.getByLabel("Tipo de comentario")).toHaveValue("idea");
  await expect(again.getByTestId("informe-mensaje")).toHaveValue("Idea ficticia 313");
  const [report] = await reportsOf();
  expect(report?.items[0]).toMatchObject({ path: "/hoy", category: "idea" });
});

test("si falla el guardado, el error se ve y el texto queda; al volver la conexión se guarda", async ({
  page,
}) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  let cortar = true;
  await page.route("**/*", (route) => {
    const req = route.request();
    if (cortar && req.method() === "POST" && req.headers()["next-action"]) return route.abort();
    return route.continue();
  });
  const texto = "Texto ficticio 313 que no se tiene que perder";
  const campo = page.getByTestId("informe-item-1").getByTestId("informe-mensaje");
  await campo.fill(texto);
  await esconderPestaña(page);

  await expect(page.getByTestId("informe-error")).toContainText("No pudimos guardar");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(estado(page)).toHaveAttribute("data-estado", "error");
  await expect(campo).toHaveValue(texto);
  expect(await mensajeEnBase()).toBe("");

  cortar = false;
  await esconderPestaña(page);
  await expect.poll(mensajeEnBase, { timeout: 8_000, intervals: [500] }).toBe(texto);
  await expect(page.getByTestId("informe-error")).toHaveCount(0);
});

test("quitar un ítem pide confirmación y lo saca de la base", async ({ page }) => {
  await abrir(page);
  await page.getByTestId("informe-agregar").click();
  await expect(page.getByTestId("informe-item-1")).toBeVisible();
  await page.getByTestId("informe-agregar").click();
  await expect(page.getByTestId("informe-item-2")).toBeVisible();
  await page
    .getByTestId("informe-item-1")
    .getByTestId("informe-mensaje")
    .fill("El que se queda 313");
  await page.getByTestId("informe-item-2").getByTestId("informe-mensaje").fill("El que se va 313");
  await esconderPestaña(page);
  await expect(estado(page)).toHaveAttribute("data-estado", "saved");

  await page.getByTestId("informe-item-2").getByTestId("informe-quitar").click();
  await expect(page.getByTestId("informe-item-2")).toContainText("No se puede deshacer");
  await page.getByTestId("informe-item-2").getByTestId("informe-quitar-si").click();
  await expect(page.getByTestId("informe-item-2")).toHaveCount(0);
  await expect
    .poll(async () => (await reportsOf())[0]?.items.map((i) => i.message))
    .toEqual(["El que se queda 313"]);
});
