import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { removeSecondUser } from "./helpers";
import { FAKE_MIC, cleanB, installRecognition, openInterview, prepareB } from "./voz-helpers";

/**
 * Flujo 229 (R25-06): movimiento y accesibilidad. Con «reducir movimiento» la barra pasa a un número de nivel (sin
 * barras animadas). Los botones miden 44 px o más, el estado se anuncia en una región `aria-live` y la pantalla no
 * tiene violaciones graves de axe ni desborde horizontal a 360 px, escuchando y sin escuchar.
 */
test.use({ ...FAKE_MIC, viewport: { width: 360, height: 800 } });
test.describe.configure({ mode: "serial" });

let sessionId = "";
test.beforeAll(async () => {
  sessionId = await prepareB("Simulación ficticia de voz 229");
});
test.afterAll(async () => {
  await cleanB();
  await removeSecondUser();
});

async function expectNoOverflowNorAxe(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    graves.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
  ).toEqual([]);
  const { scrollWidth, ancho } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    ancho: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(ancho);
}

async function expectTouchTargets(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
}

test("con movimiento normal hay barras y los botones miden 44 px", async ({ page }) => {
  await installRecognition(page, "live");
  await openInterview(page, sessionId);
  await expectTouchTargets(page, ["voice-boton"]);
  await expectNoOverflowNorAxe(page);
  await page.getByTestId("voice-boton").click();
  const nivel = page.getByTestId("voice-nivel");
  await expect(nivel).toBeVisible();
  expect(await nivel.locator("span.origin-center").count()).toBeGreaterThanOrEqual(5);
  await expectTouchTargets(page, ["voice-listo", "voice-cancelar"]);
  await expectNoOverflowNorAxe(page);
  // Hay una región viva y anuncia el resultado al terminar (mientras escucha el anuncio es el propio «Escuchando…»)
  const viva = page.getByTestId("voice-input").locator('[aria-live="polite"]');
  await expect(viva).toBeAttached();
  await page.getByTestId("voice-listo").click();
  await expect(viva.filter({ hasText: "Listo" })).toBeVisible();
});

test("con «reducir movimiento» la barra pasa a un número de nivel", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installRecognition(page, "live");
  await openInterview(page, sessionId);
  await page.getByTestId("voice-boton").click();
  const nivel = page.getByTestId("voice-nivel");
  await expect(nivel).toContainText("Nivel");
  await expect(nivel.locator("span.origin-center")).toHaveCount(0);
  // El número va de 0 a 9
  await expect(nivel).toContainText(/Nivel\s*[0-9]/);
  // El punto de «Escuchando…» no pulsa
  const pulso = page.getByTestId("voice-escuchando").locator("span.animate-pulse");
  expect(await pulso.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  await expectNoOverflowNorAxe(page);
});
