import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 301 (R28-09): a 360×640 los controles que se tocan solos miden al menos 44 px y no hay scroll
 * horizontal en las pantallas de entrada. Los links dentro de una oración quedan afuera (WCAG 2.5.8).
 * La medición completa por pantalla está en el flujo 300. Usa la persona B: no correrlo junto con el 300.
 */
test.use({ viewport: { width: 360, height: 640 } });
test.setTimeout(120_000);

async function minSide(page: Page, name: string | RegExp, role: "link") {
  const box = await page.getByRole(role, { name }).first().boundingBox();
  expect(box, String(name)).not.toBeNull();
  return Math.min(box!.width, box!.height);
}

async function noHorizontalScroll(page: Page, label: string) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scroll horizontal en ${label}`).toBeLessThanOrEqual(innerWidth);
}

test("login y registro: links y casilla de términos tocables", async ({ page }) => {
  await page.goto("/login");
  for (const name of ["Olvidé mi contraseña", "Volver al inicio"]) {
    expect(await minSide(page, name, "link"), name).toBeGreaterThanOrEqual(43.5);
  }
  await noHorizontalScroll(page, "/login");

  await page.goto("/register");
  for (const name of ["Ya tengo cuenta", "Volver al inicio"]) {
    expect(await minSide(page, name, "link"), name).toBeGreaterThanOrEqual(43.5);
  }
  const box = await page.getByRole("checkbox").first().boundingBox();
  expect(Math.min(box!.width, box!.height), "casilla de términos").toBeGreaterThanOrEqual(24);
  await noHorizontalScroll(page, "/register");
});

test.describe("con sesión", () => {
  test.beforeAll(async () => {
    await ensureSecondUser();
  });
  test.afterAll(async () => {
    await removeSecondUser();
  });

  test("el pie de la app tiene links de 44 px y las pantallas no se desbordan", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    for (const path of ["/hoy", "/jobs?estado=todas", "/cv", "/applications", "/settings"]) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible();
      const footer = page.locator("footer").last();
      for (const name of ["Privacidad", "Términos"]) {
        const box = await footer.getByRole("link", { name }).boundingBox();
        expect(Math.min(box!.width, box!.height), `${name} en ${path}`).toBeGreaterThanOrEqual(
          43.5,
        );
      }
      await noHorizontalScroll(page, path);
    }
  });
});
