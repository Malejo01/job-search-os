import { expect, test, type Page } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { INFORME_URL, clearReportsOf, reportsOf, seedDraft } from "./informe-helpers";
import { clearFeedbackOf, feedbackOf } from "./recorrido-helpers";

/**
 * Flujo 318 (R29-03): «Agregar al informe» en el modal «¿Algo no anduvo?» (solo testers y admins). El comentario no se
 * manda suelto: queda como un ítem del borrador del informe, con la pantalla desde la que se escribió (o la elegida con
 * «Comentar esta pantalla»), y se ve en `/recorrido/informe`. Con 30 ítems avisa y no pierde el texto. Datos
 * inventados.
 */
test.use({ viewport: { width: 390, height: 900 } });
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.beforeEach(async () => {
  await clearReportsOf();
  await clearFeedbackOf();
});
test.afterAll(async () => {
  await clearReportsOf();
  await clearFeedbackOf();
  await removeSecondUser();
});

async function abrirModal(page: Page, ruta = "/hoy") {
  await loginAsSecondUser(page);
  await page.goto(ruta);
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog.getByTestId("feedback-agregar-informe")).toBeVisible();
  return dialog;
}

test("suma el comentario como ítem del borrador, no como comentario suelto, y lo muestra en el informe", async ({
  page,
}) => {
  const dialog = await abrirModal(page);
  await dialog.getByRole("radio", { name: "Algo es confuso" }).check();
  await dialog.getByLabel("Tu mensaje").fill("Mensaje ficticio 318 desde el modal");
  await dialog.getByLabel("¿Qué te gustaría que cambie?").fill("Que diga más claro qué hacer");
  await dialog.getByTestId("feedback-agregar-informe").click();

  const gracias = page.getByTestId("feedback-gracias-informe");
  await expect(gracias).toContainText("Lo sumamos a tu informe");
  await expect(dialog).toBeHidden();
  expect(await feedbackOf(E2E_B_USER_ID)).toHaveLength(0);

  const [report] = await reportsOf();
  expect(report?.status).toBe("borrador");
  expect(report?.items).toHaveLength(1);
  expect(report?.items[0]).toMatchObject({ path: "/hoy", category: "confuso" });
  expect(report?.items[0]?.message).toContain("Mensaje ficticio 318 desde el modal");
  expect(report?.items[0]?.message).toContain("Que diga más claro qué hacer");

  // El borrador del modal se borró y el link lleva al informe, donde el ítem ya está
  expect(await page.evaluate(() => sessionStorage.getItem("jso:feedback-borrador:v1"))).toBeNull();
  await gracias.getByRole("link", { name: "Ver mi informe" }).click();
  await expect(page).toHaveURL(new RegExp(`${INFORME_URL}$`));
  await expect(page.getByTestId("informe-item-1").getByTestId("informe-mensaje")).toHaveValue(
    /Mensaje ficticio 318 desde el modal/,
  );
  await expect(page.getByTestId("informe-item-1").getByLabel("Pantalla")).toHaveValue("/hoy");
});

test("«Comentar esta pantalla» del recorrido: el ítem lleva la pantalla elegida, sin ids", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/recorrido");
  await page
    .getByTestId("recorrido-match-transparencia")
    .getByRole("button", { name: /Comentar esta pantalla/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog.getByTestId("feedback-agregar-informe")).toBeVisible();
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByLabel("Tu mensaje").fill("Idea ficticia 318 sobre la transparencia");
  await dialog.getByTestId("feedback-agregar-informe").click();
  await expect(page.getByTestId("feedback-gracias-informe")).toBeVisible();
  const [report] = await reportsOf();
  expect(report?.items[0]).toMatchObject({ path: "/jobs/[id]", category: "idea" });
});

test("sin tipo o sin texto no suma nada y lo dice, conservando lo escrito", async ({ page }) => {
  const dialog = await abrirModal(page);
  await dialog.getByTestId("feedback-agregar-informe").click();
  await expect(dialog.getByRole("alert")).toContainText("Elegí qué tipo de comentario es.");
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByTestId("feedback-agregar-informe").click();
  await expect(dialog.getByRole("alert")).toContainText("Escribí tu mensaje");
  await dialog.getByLabel("Tu mensaje").fill("Texto ficticio 318 que se conserva");
  await expect(dialog).toBeVisible();
  expect(await reportsOf()).toHaveLength(0);
});

test("con 30 ítems avisa que el informe está lleno y no pierde el texto", async ({ page }) => {
  await seedDraft(Array.from({ length: 30 }, (_, n) => `Ítem ficticio ${n + 1}`));
  const dialog = await abrirModal(page);
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByLabel("Tu mensaje").fill("El ítem número 31 ficticio");
  await dialog.getByTestId("feedback-agregar-informe").click();
  await expect(dialog.getByRole("alert")).toContainText("máximo de 30 ítems");
  await expect(dialog.getByLabel("Tu mensaje")).toHaveValue("El ítem número 31 ficticio");
  expect((await reportsOf())[0]?.items).toHaveLength(30);
});
