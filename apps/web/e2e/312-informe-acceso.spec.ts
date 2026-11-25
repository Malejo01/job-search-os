import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";
import { INFORME_URL, clearReportsOf } from "./informe-helpers";

/**
 * Flujo 312 (R29-03): «Mi informe de revisión» es solo para testers y admins. Una tester (la persona B) entra, ve a
 * Afi explicando y el link desde `/recorrido`; una persona común recibe 404 en la pantalla y su modal «¿Algo no
 * anduvo?» queda idéntico al de siempre (sin «Agregar al informe»). Sin sesión, a `/login`. Datos inventados.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await ensureSecondUser();
  await ensureOffUser();
  await clearReportsOf();
});
test.afterAll(async () => {
  await clearReportsOf();
  await removeOffUser();
  await removeSecondUser();
});

test("una tester entra al informe y ve a Afi con la explicación; el link está en /recorrido", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/recorrido");
  await page.getByTestId("recorrido-informe-link").click();
  await expect(page).toHaveURL(new RegExp(`${INFORME_URL}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: "Mi informe de revisión" }),
  ).toBeVisible();
  await expect(page.getByTestId("informe-afi-texto")).toHaveText(
    "Contame todo lo que viste: podés escribir, dictar y sumar capturas",
  );
  // Sin ítems todavía: el vacío invita a empezar
  await expect(page.getByText("Todavía no sumaste nada")).toBeVisible();
  await expect(page.getByTestId("informe-agregar")).toBeEnabled();
});

test("una persona común recibe 404 en la pantalla", async ({ page }) => {
  await loginAsOffUser(page);
  const res = await page.goto(INFORME_URL);
  expect(res?.status()).toBe(404);
  await expect(page.getByTestId("informe-afi")).toHaveCount(0);
  await expect(page.getByTestId("informe-agregar")).toHaveCount(0);
});

test("el modal de una tester tiene «Agregar al informe»", async ({ page }) => {
  await loginAsSecondUser(page);
  await page.goto("/hoy");
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog.getByTestId("feedback-agregar-informe")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enviar" })).toBeVisible();
});

test("el modal de una persona común es el de siempre, sin «Agregar al informe»", async ({
  page,
}) => {
  await loginAsOffUser(page);
  await page.goto("/hoy");
  await page.getByRole("button", { name: "¿Algo no anduvo?" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Contanos qué pasó" });
  await expect(dialog.getByRole("button", { name: "Enviar" })).toBeVisible();
  // Se da un momento a que el servidor conteste la pregunta de acceso antes de afirmar que no aparece
  await page.waitForTimeout(1_000);
  await expect(dialog.getByTestId("feedback-agregar-informe")).toHaveCount(0);
});

test("sin sesión, la pantalla manda a /login", async ({ page }) => {
  await page.goto(INFORME_URL);
  await expect(page).toHaveURL(/\/login/);
});
