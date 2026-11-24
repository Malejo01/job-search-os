import { expect, test, type Page } from "@playwright/test";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { FICHA_STAR, clearAcademyReviews, makeBTester } from "./revision-helpers";

/**
 * Flujo 230 (R26-01): una tester aprueba una ficha de Academy desde la app y se ve en `/academy`, en su detalle y en
 * su «?» (Interview). Las fichas son las de prueba (`e2e/fixtures/academy`, todas en borrador). La persona B es
 * tester por la base (`user_roles`), que es lo que exige la función SQL para escribir.
 */
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  await makeBTester();
  await clearAcademyReviews();
});
test.afterAll(async () => {
  await clearAcademyReviews();
  await removeSecondUser();
});

async function openFicha(page: Page, slug: string) {
  await page.goto("/settings/academy");
  const item = page.getByTestId(`academy-revision-${slug}`);
  await item.locator("summary").click();
  return item;
}

test("en borrador no se ve; al aprobarla aparece en Academy, en su detalle y en su «?»", async ({
  page,
}) => {
  await loginAsSecondUser(page);

  // Antes: Academy vacío, detalle 404 y sin «?» en Interview
  await page.goto("/academy");
  await expect(page.getByTestId("academy-vacia")).toBeVisible();
  expect((await page.goto(`/academy/${FICHA_STAR.slug}`))?.status()).toBe(404);
  await page.goto("/interview");
  await expect(page.getByTestId(`ayuda-ficha-${FICHA_STAR.slug}`)).toHaveCount(0);

  // La tester la aprueba
  const item = await openFicha(page, FICHA_STAR.slug);
  await expect(item.getByTestId("academy-estado")).toHaveText("Borrador");
  await item.getByTestId("academy-aprobar").click();
  await expect(item.getByTestId("academy-estado")).toHaveText("Aprobada");
  await expect(item.getByTestId("academy-estado-detalle")).toContainText("Aprobada desde la app");

  // Después: la ven todas las personas con sesión
  await page.goto("/academy");
  await expect(page.getByTestId("academy-lista")).toContainText(FICHA_STAR.titulo);
  const detalle = await page.goto(`/academy/${FICHA_STAR.slug}`);
  expect(detalle?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: FICHA_STAR.titulo })).toBeVisible();
  await page.goto("/interview");
  await expect(page.getByTestId(`ayuda-ficha-${FICHA_STAR.slug}`)).toBeVisible();
});
