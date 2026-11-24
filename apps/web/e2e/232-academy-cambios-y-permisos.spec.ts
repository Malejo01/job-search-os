import { expect, test } from "@playwright/test";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";
import {
  FICHA_STAR,
  academyReviewsOf,
  clearAcademyReviews,
  makeBTester,
  removeBTesterRole,
} from "./revision-helpers";

/**
 * Flujo 232 (R26-01): «Pedir cambios» exige un comentario, queda en el historial y no publica nada. Una persona común
 * recibe 404 en la pantalla de revisión. Una tester solo por variable de entorno (sin el rol en la base) puede leer
 * las fichas pero no aprobar: la base lo exige además de la app, y la pantalla lo dice.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await makeBTester();
  await clearAcademyReviews();
});
test.afterAll(async () => {
  await clearAcademyReviews();
  await removeOffUser();
  await removeSecondUser();
});

test("pedir cambios necesita comentario, queda en el historial y la ficha no se publica", async ({
  page,
}) => {
  await loginAsSecondUser(page);
  await page.goto("/settings/academy");
  const item = page.getByTestId(`academy-revision-${FICHA_STAR.slug}`);
  await item.locator("summary").click();

  // Sin comentario el navegador no deja enviar (required) y no se guarda nada
  await item.getByTestId("academy-cambios").click();
  expect(await academyReviewsOf(FICHA_STAR.slug)).toEqual([]);

  await item.getByLabel("¿Qué hay que cambiar?").fill("Falta un ejemplo de la vida real.");
  await item.getByTestId("academy-cambios").click();
  await expect(item.getByTestId("academy-estado-detalle")).toContainText("Se pidieron cambios");
  await expect(item.getByTestId("academy-estado")).toHaveText("Borrador");
  await expect(page.getByTestId("academy-historial")).toContainText("Falta un ejemplo");
  await expect(page.getByTestId("academy-historial")).toContainText("Pidió cambios");
  expect(await academyReviewsOf(FICHA_STAR.slug)).toEqual([
    { status: "cambios", comment: "Falta un ejemplo de la vida real." },
  ]);

  // No se publicó
  await page.goto("/academy");
  await expect(page.getByTestId("academy-vacia")).toBeVisible();
});

test("una persona común recibe 404 en la revisión", async ({ page }) => {
  await ensureOffUser();
  await loginAsOffUser(page);
  expect((await page.goto("/settings/academy"))?.status()).toBe(404);
});

test("una tester sin el rol en la base lee las fichas pero no puede aprobar", async ({ page }) => {
  await removeBTesterRole();
  await loginAsSecondUser(page);
  const res = await page.goto("/settings/academy");
  expect(res?.status()).toBe(200);
  await expect(page.getByText("No pudimos leer las revisiones")).toBeVisible();
  await expect(page.getByTestId("academy-aprobar")).toHaveCount(0);
});
