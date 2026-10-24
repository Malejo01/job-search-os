import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 77 (T5): accesibilidad (axe, WCAG 2.0/2.1 A y AA) de dos pantallas que no tenían:
 * `/settings/metricas` (tablero de la beta, solo admin) y `/precios` encendida. Mismo patrón que
 * `70-axe-sesion.spec.ts`, pero falla solo con violaciones `serious` o `critical`; las `minor` y
 * `moderate` quedan como anotación. Sin datos sembrados: ambas pantallas solo se leen.
 *
 * En el CI el usuario e2e es admin (`ADMIN_EMAILS` incluye `E2E_EMAIL`); si en otro entorno no lo
 * es, la página da 404 y el caso se saltea. `PRICING_ENABLED` está apagado en el CI: los casos de
 * `/precios` se saltean allá y corren en local con la variable en 1 (igual que el 71).
 */
const PRICING_ON = process.env.PRICING_ENABLED === "1";

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

async function auditar(page: Page, label: string, viewport: string) {
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  // Regla, impacto y selectores; nunca el HTML entero
  const resumen = (v: (typeof violations)[number]) =>
    `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`;
  const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const leves = violations.filter((v) => !(v.impact === "serious" || v.impact === "critical"));
  for (const v of leves) {
    test.info().annotations.push({ type: `axe ${label} ${viewport}`, description: resumen(v) });
  }
  expect(graves.map(resumen), `Violaciones serious/critical en ${label} a ${viewport}`).toEqual([]);

  const { scrollWidth, ancho } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    ancho: window.innerWidth,
  }));
  expect(scrollWidth, `Desborde horizontal en ${label} a ${viewport}`).toBeLessThanOrEqual(ancho);
}

test.describe("Flujo 77: axe en /settings/metricas (admin) y /precios", () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`viewport ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`/settings/metricas: sin violaciones graves`, async ({ page }) => {
        await login(page);
        const response = await page.goto("/settings/metricas");
        test.skip(
          response?.status() === 404,
          "El usuario e2e no es admin en este entorno (ADMIN_EMAILS sin E2E_EMAIL): /settings/metricas da 404",
        );
        await expect(
          page.getByRole("heading", { level: 1, name: "Métricas de la beta" }),
        ).toBeVisible();
        await auditar(page, "/settings/metricas", viewport.name);
      });

      test(`/precios encendida: sin violaciones graves`, async ({ page }) => {
        test.skip(!PRICING_ON, "PRICING_ENABLED apagado en este entorno");
        const response = await page.goto("/precios");
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Precios" })).toBeVisible();
        await auditar(page, "/precios", viewport.name);
      });
    });
  }
});
