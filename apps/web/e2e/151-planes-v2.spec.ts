import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { login } from "./helpers";

/**
 * Flujo 151 (R15-1): página de planes con `PRICING_V2`. Dos versiones, a 390 px y en escritorio:
 * - sin `PRICING_V2=1`: la página queda como hoy (sin recomendado, sin precio por día, gratis primero);
 * - con `PRICING_ENABLED=1` y `PRICING_V2=1`: el más completo primero, «Recomendado» (nunca «Más elegido»),
 *   precio por día, beneficios, lo que no incluye y nada de urgencia ni garantía.
 * El servidor del e2e hereda el entorno del runner: en el CI los precios están apagados y estos casos se
 * saltean, igual que el flujo 71. Para correrlos: `PRICING_ENABLED=1` (versión de siempre) o
 * `PRICING_ENABLED=1 PRICING_V2=1` (versión nueva). Con `CAPTURAS=1` guardan una captura por ancho en
 * `test-results/capturas/` (artefacto del CI, nunca al repo).
 */
const ON = process.env.PRICING_ENABLED === "1";
const V2 = ON && process.env.PRICING_V2 === "1";
const V1 = ON && !V2;

const ANCHOS = [
  { nombre: "390", width: 390, height: 844 },
  { nombre: "1280", width: 1280, height: 900 },
] as const;

async function capturar(page: Page, nombre: string): Promise<void> {
  if (process.env.CAPTURAS !== "1") return;
  const dir = join(__dirname, "..", "test-results", "capturas");
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${nombre}.png`), fullPage: true });
}

async function sinDesborde(page: Page): Promise<void> {
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(desborde).toBe(false);
}

for (const ancho of ANCHOS) {
  test.describe(`Flujo 151: /precios a ${ancho.nombre} px`, () => {
    test.use({ viewport: { width: ancho.width, height: ancho.height } });

    test("sin PRICING_V2 queda como hoy: gratis primero, sin recomendado ni precio por día", async ({
      page,
    }) => {
      test.skip(!V1, "necesita PRICING_ENABLED=1 y PRICING_V2 apagado");
      expect((await page.goto("/precios"))?.status()).toBe(200);
      await expect(page.locator("[data-precios-v2]")).toHaveCount(0);
      await expect(page.getByTestId("plan-recomendado")).toHaveCount(0);
      await expect(page.getByTestId("precio-dia-lista")).toHaveCount(0);
      await expect(page.getByTestId("precios-sin-promesas")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "No incluye" })).toHaveCount(0);
      // El orden de siempre: Gratis y después Beta
      const orden = await page
        .getByTestId("precios-planes")
        .locator("> li")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
      expect(orden).toEqual(["plan-gratis", "plan-lista"]);
      await expect(page.getByTestId("precio-lista")).toHaveText(/^\$ 20[.\s]?000 por mes$/);
      await capturar(page, `precios-v1-${ancho.nombre}`);
      await sinDesborde(page);
    });

    test("con PRICING_V2: más completo primero, «Recomendado», precio por día y lo que no incluye", async ({
      page,
    }) => {
      test.skip(!V2, "necesita PRICING_ENABLED=1 y PRICING_V2=1");
      expect((await page.goto("/precios"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Precios" })).toBeVisible();

      // Anclaje: el plan completo va primero
      const orden = await page
        .getByTestId("precios-planes")
        .locator("> li")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
      expect(orden).toEqual(["plan-lista", "plan-gratis"]);

      // «Recomendado», solo en el plan de la beta; nunca una afirmación de elección no medida
      await expect(page.getByTestId("plan-recomendado")).toHaveCount(1);
      await expect(page.getByTestId("plan-lista").getByTestId("plan-recomendado")).toHaveText(
        "Recomendado",
      );
      await expect(page.getByText(/m[aá]s elegido|m[aá]s vendido|popular/i)).toHaveCount(0);

      // El monto es el de siempre; el precio por día sale de él, redondeado hacia arriba
      await expect(page.getByTestId("precio-lista")).toHaveText(/^\$ 20[.\s]?000 por mes$/);
      await expect(page.getByTestId("precio-dia-lista")).toHaveText(/^\$ 667 por día$/);
      await expect(page.getByTestId("precio-dia-cuenta-lista")).toContainText(
        "÷ 30 días, redondeado hacia arriba",
      );
      await expect(page.getByTestId("precio-dia-gratis")).toHaveCount(0);
      await expect(page.getByTestId("precio-gratis")).toHaveText("Gratis");

      // Beneficios como resultados, con los topes reales
      await expect(page.getByTestId("beneficios-lista")).toContainText(
        "Hasta 15 ofertas leídas por día contra tu perfil",
      );
      await expect(page.getByTestId("beneficios-gratis")).toContainText(
        "Hasta 3 ofertas leídas por día",
      );

      // Lo que no incluye: el plan gratis lo lista; en gris, con el contraste del token AA
      const noIncluye = page.getByTestId("no-incluye-gratis");
      await expect(noIncluye).toContainText("No llega a las 15 ofertas por día: el tope es 3");
      await expect(noIncluye).toHaveClass(/text-fg-subtle/);

      // Sin urgencia falsa, sin precios tachados ni garantía que los legales no dicen
      await expect(
        page.getByText(/garant|quedan|últimos|última oportunidad|antes que/i),
      ).toHaveCount(0);
      await expect(page.getByText(/cancel[aá]s cuando/i)).toHaveCount(0);
      await expect(page.locator("s, del, strike")).toHaveCount(0);
      await expect(page.getByTestId("precios-sin-promesas")).toContainText(
        "Ningún plan promete entrevistas ni trabajo",
      );

      // Lo de siempre sigue: sin link de pago, con «Pedir acceso»
      await expect(page.locator('a[href*="mpago"], a[href*="mercadopago"]')).toHaveCount(0);
      await expect(page.getByTestId("plan-lista")).toContainText(
        "Te pasamos el link de pago cuando te invitemos",
      );
      await expect(page.getByRole("link", { name: "Pedir acceso" }).last()).toHaveAttribute(
        "href",
        "/acceso",
      );
      await capturar(page, `precios-v2-${ancho.nombre}`);
      await sinDesborde(page);
    });

    test("con PRICING_V2: sin violaciones graves de accesibilidad (AA)", async ({ page }) => {
      test.skip(!V2, "necesita PRICING_ENABLED=1 y PRICING_V2=1");
      await page.goto("/precios");
      await page.waitForLoadState("networkidle");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const graves = violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);
      expect(graves).toEqual([]);
    });
  });
}

test.describe("Flujo 151: «Tu plan» en Ajustes", () => {
  test("sin PRICING_V2, «Tu plan» no trae precio por día ni «No incluye»", async ({ page }) => {
    test.skip(!V1, "necesita PRICING_ENABLED=1 y PRICING_V2 apagado");
    await login(page);
    await page.goto("/settings");
    await expect(page.getByTestId("tu-plan")).toContainText("Gratis");
    await expect(page.getByTestId("tu-plan-precio-dia")).toHaveCount(0);
    await expect(page.getByTestId("tu-plan-no-incluye")).toHaveCount(0);
  });

  test("con PRICING_V2, la cuenta del e2e (plan gratis) ve el precio por día y lo que no incluye", async ({
    page,
  }) => {
    test.skip(!V2, "necesita PRICING_ENABLED=1 y PRICING_V2=1");
    await login(page);
    await page.goto("/settings");
    const tuPlan = page.getByTestId("tu-plan");
    await expect(tuPlan).toContainText("Gratis");
    await expect(tuPlan.getByTestId("tu-plan-precio-dia")).toContainText("$ 667 por día");
    await expect(tuPlan.getByTestId("tu-plan-no-incluye")).toContainText(
      "No llega a las 15 ofertas por día: el tope es 3",
    );
    await expect(tuPlan.getByTestId("tu-plan-no-incluye")).toHaveClass(/text-fg-subtle/);
    await expect(tuPlan.getByText(/garant|quedan|últimos/i)).toHaveCount(0);
  });
});
