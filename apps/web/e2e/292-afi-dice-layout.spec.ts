import { expect, test, type Page } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 292 (R28-15): la disposición de Afi que habla. En el celular (360 px) Afi mide 96 px y va arriba de la
 * burbuja, sin scroll horizontal; en la computadora Afi mide 128 px y la burbuja está a su derecha. Hoy e Interview.
 * Persona B (ficticia).
 */
const PAGES = [
  { ruta: "/hoy", testId: "afi-dice" },
  { ruta: "/interview", testId: "afi-dice-interview" },
] as const;

async function sinDesborde(page: Page): Promise<void> {
  const { sw, w } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: window.innerWidth,
  }));
  expect(sw).toBeLessThanOrEqual(w);
}

test.use({ reducedMotion: "reduce" });

test.describe("Flujo 292: disposición de Afi que habla (R28-15)", () => {
  test.beforeEach(async () => {
    await ensureSecondUser();
  });
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  for (const { ruta, testId } of PAGES) {
    test(`${ruta} a 360 px: Afi de 96 px arriba, burbuja abajo y sin scroll horizontal`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await loginAsSecondUser(page);
      const res = await page.goto(ruta);
      test.skip(res?.status() === 404, `${ruta} no está disponible en este entorno`);
      const dice = page.getByTestId(testId).first();
      await expect(dice).toBeVisible();
      const afi = await dice.locator("[data-afi]").first().boundingBox();
      const burbuja = await dice.getByTestId(`${testId}-burbuja`).boundingBox();
      expect(afi && burbuja).toBeTruthy();
      expect(Math.round(afi!.height)).toBeGreaterThanOrEqual(95);
      expect(Math.round(afi!.height)).toBeLessThanOrEqual(97);
      // Afi arriba y la burbuja abajo
      expect(burbuja!.y).toBeGreaterThanOrEqual(afi!.y + afi!.height - 1);
      expect(burbuja!.x + burbuja!.width).toBeLessThanOrEqual(360);
      await sinDesborde(page);
    });

    test(`${ruta} a 1280 px: Afi de 128 px y la burbuja a su derecha`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      await loginAsSecondUser(page);
      const res = await page.goto(ruta);
      test.skip(res?.status() === 404, `${ruta} no está disponible en este entorno`);
      const dice = page.getByTestId(testId).first();
      await expect(dice).toBeVisible();
      const afi = await dice.locator("[data-afi]").first().boundingBox();
      const burbuja = await dice.getByTestId(`${testId}-burbuja`).boundingBox();
      expect(afi && burbuja).toBeTruthy();
      expect(Math.round(afi!.height)).toBeGreaterThanOrEqual(127);
      expect(Math.round(afi!.height)).toBeLessThanOrEqual(129);
      expect(burbuja!.x).toBeGreaterThanOrEqual(afi!.x + afi!.width - 1);
      await sinDesborde(page);
    });
  }
});
