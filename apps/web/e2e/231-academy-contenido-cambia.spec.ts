import { expect, test } from "@playwright/test";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { FICHA_SENIORITY, clearAcademyReviews, editFicha, makeBTester } from "./revision-helpers";

/**
 * Flujo 231 (R26-01): si el contenido de una ficha cambia, la aprobación vieja no vale y vuelve a borrador (falla
 * cerrado). El spec aprueba la ficha de prueba, le agrega una línea al archivo (el servidor lee el disco en cada
 * pedido) y comprueba que deja de verse en Academy, en el detalle y en el «?»; la pantalla de revisión dice que el
 * texto cambió. Al final deja el archivo como estaba.
 */
test.describe.configure({ mode: "serial" });
let restore: (() => void) | null = null;
test.beforeAll(async () => {
  await makeBTester();
  await clearAcademyReviews();
});
test.afterAll(async () => {
  restore?.();
  await clearAcademyReviews();
  await removeSecondUser();
});

test("aprobada se ve; con el contenido cambiado deja de verse y pide revisar de nuevo", async ({
  page,
}) => {
  await loginAsSecondUser(page);

  await page.goto("/settings/academy");
  const item = page.getByTestId(`academy-revision-${FICHA_SENIORITY.slug}`);
  await item.locator("summary").click();
  await item.getByTestId("academy-aprobar").click();
  await expect(item.getByTestId("academy-estado")).toHaveText("Aprobada");
  await page.goto("/academy");
  await expect(page.getByTestId("academy-lista")).toContainText(FICHA_SENIORITY.titulo);
  await page.goto("/interview");
  await expect(page.getByTestId(`ayuda-ficha-${FICHA_SENIORITY.slug}`)).toBeVisible();

  // Cambia el contenido: la huella ya no es la aprobada
  restore = editFicha(FICHA_SENIORITY.slug, "Una línea nueva que nadie revisó.");
  await page.goto("/academy");
  await expect(page.getByTestId("academy-vacia")).toBeVisible();
  expect((await page.goto(`/academy/${FICHA_SENIORITY.slug}`))?.status()).toBe(404);
  await page.goto("/interview");
  await expect(page.getByTestId(`ayuda-ficha-${FICHA_SENIORITY.slug}`)).toHaveCount(0);

  await page.goto("/settings/academy");
  const again = page.getByTestId(`academy-revision-${FICHA_SENIORITY.slug}`);
  await expect(again.getByTestId("academy-estado")).toHaveText("Borrador");
  await expect(again.getByTestId("academy-estado-detalle")).toContainText(
    "el texto cambió después",
  );

  // Volver el archivo a como estaba devuelve la misma huella: la aprobación vuelve a valer
  restore();
  restore = null;
  await page.goto("/academy");
  await expect(page.getByTestId("academy-lista")).toContainText(FICHA_SENIORITY.titulo);
});
