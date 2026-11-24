import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { loginAsSecondUser, removeSecondUser } from "./helpers";
import { FICHA_STAR, clearAcademyReviews, makeBTester } from "./revision-helpers";

/**
 * Flujo 244 (R26-07): las ramas de Academy y de los «?» que los flujos 183 a 185 solo recorren cuando hay una ficha
 * aprobada (hasta ahora no corrían nunca con una). Las fichas son las de prueba (`e2e/fixtures/academy`, en
 * borrador); la persona B, tester por la base, aprueba una desde la app y después se prueba lo que ve cualquier
 * persona: la lista con buscador, el detalle con `?desde=` y el «?» de Interview, con axe en cada una.
 */
const ORIGEN = /^\/academy\/[a-z0-9-]+\?desde=interview$/;

test.describe.configure({ mode: "serial" });
// Un solo caso con varias pantallas que compilan en frío en `next dev`: el tiempo por defecto (90 s) no alcanza
test.setTimeout(180_000);
test.beforeAll(async () => {
  await makeBTester();
  await clearAcademyReviews();
});
test.afterAll(async () => {
  await clearAcademyReviews();
  await removeSecondUser().catch(() => {});
});

test("con una ficha aprobada: lista con buscador, detalle con origen y «?» de Interview, sin violaciones de axe", async ({
  page,
}) => {
  await loginAsSecondUser(page);

  // La tester aprueba la ficha desde la app
  await page.goto("/settings/academy");
  const item = page.getByTestId(`academy-revision-${FICHA_STAR.slug}`);
  await item.locator("summary").click();
  await item.getByTestId("academy-aprobar").click();
  await expect(item.getByTestId("academy-estado")).toHaveText("Aprobada");

  // Lista: la ficha, el buscador y el conteo
  await page.goto("/academy");
  const lista = page.getByTestId("academy-lista");
  await expect(lista).toContainText(FICHA_STAR.titulo);
  const total = await lista.getByRole("link").count();
  const buscador = page.getByLabel("Buscar una ficha");
  await buscador.fill("zzzzzz-no-existe");
  await expect(page.getByTestId("academy-sin-resultados")).toBeVisible();
  await buscador.fill("");
  await expect(page.getByTestId("academy-lista").getByRole("link")).toHaveCount(total);
  expect((await axeSummary(page)).violations).toEqual([]);

  // Detalle: lectura, tiempo y, al venir de Interview, la ficha no se ofrece a sí misma
  const res = await page.goto(`/academy/${FICHA_STAR.slug}?desde=interview`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("academy-lectura")).toContainText("min de lectura");
  await expect(page.getByTestId("academy-te-puede-servir")).toHaveCount(0);
  expect((await axeSummary(page)).violations).toEqual([]);

  // El «?» de Interview: enlaza a Academy con el origen de la lista cerrada
  await page.goto("/interview");
  const ayuda = page.getByTestId(`ayuda-ficha-${FICHA_STAR.slug}`);
  await expect(ayuda).toBeVisible();
  // Es un <details>: cerrado, su enlace no está en el árbol de accesibilidad y getByRole no lo encuentra
  await ayuda.locator("summary").click();
  const href = await ayuda
    .getByRole("link", { name: "Ver en Academy" })
    .getAttribute("href", { timeout: 5000 });
  expect(href).toMatch(ORIGEN);
  expect((await axeSummary(page)).violations).toEqual([]);
});
