import { expect, test, type Page } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { FAKE_MIC, installRecognition } from "./voz-helpers";
import { clearFeedbackOf, feedbackOf } from "./recorrido-helpers";

/**
 * Flujo 311 (R29-01): cuando el envío falla, el error se ve (`role="alert"`) y el texto no se pierde: queda en el
 * campo, se restaura al cerrar y volver a abrir el modal, y el borrador solo se borra con el «¡Gracias!». Cubre
 * corte de red, sesión vencida y mensaje de más de 2.000 caracteres (escrito y dictado). Datos inventados.
 */
test.use({ ...FAKE_MIC, viewport: { width: 390, height: 800 } });
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
});
test.beforeEach(async () => {
  await clearFeedbackOf();
});
test.afterAll(async () => {
  await clearFeedbackOf();
  await removeSecondUser();
});

const DRAFT_KEY = "jso:feedback-borrador:v1";
const TEXTO = "Texto ficticio 311 que no se tiene que perder";

async function abrir(page: Page) {
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("sin conexión: el error se ve, el texto queda y se restaura; al reintentar se envía y se borra", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  let cortar = true;
  // Una server action viaja como POST con la cabecera `next-action`: se corta mientras `cortar` sea true
  await page.route("**/*", (route) => {
    const req = route.request();
    if (cortar && req.method() === "POST" && req.headers()["next-action"]) return route.abort();
    return route.continue();
  });

  const dialog = await abrir(page);
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  await dialog.getByLabel("Tu mensaje").fill(TEXTO);
  await dialog.getByRole("button", { name: "Enviar" }).click();

  await expect(dialog.getByRole("alert")).toContainText("No pudimos conectarnos");
  await expect(dialog.getByRole("alert")).toContainText("Tu mensaje sigue acá");
  await expect(dialog.getByLabel("Tu mensaje")).toHaveValue(TEXTO);
  await expect(dialog.getByRole("button", { name: "Enviar" })).toBeEnabled();
  expect(await feedbackOf(E2E_B_USER_ID)).toHaveLength(0);

  // Cerrar y volver a abrir: el borrador vuelve con la categoría y el texto
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toContain(TEXTO);
  await abrir(page);
  await expect(dialog.getByLabel("Tu mensaje")).toHaveValue(TEXTO);
  await expect(dialog.getByRole("radio", { name: "Tengo una idea" })).toBeChecked();

  // Vuelve la conexión: se envía, agradece y recién ahí se borra el borrador
  cortar = false;
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("¡Gracias! Lo leemos todo.")).toBeVisible();
  const [row] = await feedbackOf(E2E_B_USER_ID);
  expect(row?.message).toBe(TEXTO);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toBeNull();
});

test("sesión vencida: no manda a /login ni pierde el texto; avisa con un link a otra pestaña", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  const dialog = await abrir(page);
  await dialog.getByRole("radio", { name: "Algo no anduvo" }).check();
  await dialog.getByLabel("Tu mensaje").fill(TEXTO);

  // Se vence la sesión: sin cookies, la server action no tiene a quién guardarle el comentario
  await page.context().clearCookies();
  await dialog.getByRole("button", { name: "Enviar" }).click();

  await expect(dialog.getByRole("alert")).toContainText("Se venció tu sesión");
  await expect(dialog.getByRole("link", { name: /Iniciar sesión/ })).toHaveAttribute(
    "target",
    "_blank",
  );
  await expect(page).toHaveURL(/\/hoy/);
  await expect(dialog.getByLabel("Tu mensaje")).toHaveValue(TEXTO);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY)).toContain(TEXTO);
  expect(await feedbackOf(E2E_B_USER_ID)).toHaveLength(0);
});

test("más de 2.000 caracteres, escritos o dictados: avisa cuánto se pasa y no corta nada", async ({
  page,
}) => {
  await installRecognition(page, "live");
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  const dialog = await abrir(page);
  await dialog.getByRole("radio", { name: "Tengo una idea" }).check();
  const campo = dialog.getByLabel("Tu mensaje");

  // Pegado: 2.050 caracteres
  const largo = "a".repeat(2050);
  await campo.fill(largo);
  await expect(dialog.getByTestId("feedback-tope")).toContainText("se pasa 50 caracteres");
  await dialog.getByRole("button", { name: "Enviar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("50 caracteres del máximo");
  expect(await feedbackOf(E2E_B_USER_ID)).toHaveLength(0);

  // Dictado: con 1.990 caracteres escritos, lo dictado pasa del tope y NO se corta
  const base = "b".repeat(1990);
  await campo.fill(base);
  await expect(dialog.getByTestId("feedback-tope")).toHaveCount(0);
  await dialog.getByTestId("voice-boton").click();
  // El parcial llega a los 50 ms: esperarlo, así el final no queda pisado por él
  await expect(dialog.getByTestId("voice-vista-previa")).toContainText("Trabajé con datos");
  await page.evaluate(() => (window as unknown as { __recFinal: () => void }).__recFinal());
  await dialog.getByTestId("voice-listo").click();
  const dictado = "Trabajé con datos de ventas";
  await expect(campo).toHaveValue(`${base} ${dictado}`);
  await expect(dialog.getByTestId("feedback-tope")).toBeVisible();
  await expect(dialog.getByTestId("message-counter")).toContainText("de más");
});
