import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Flujo 61 (ronda 93): accesibilidad de las páginas públicas con axe, sin sesión. Dos viewports por
 * página. Las páginas son ISR y pueden estar vacías: se mira estructura, nunca cantidades.
 * `/demo/<perfil>` queda afuera (lo cubre la ronda 92). Los metadatos viven en
 * `58-metadatos-publicas.spec.ts`.
 */
const PATHS = [
  "/",
  "/mercado",
  "/mercado/data_analyst",
  "/ofertas",
  "/demo",
  "/como-esta-hecho",
  "/acceso",
  "/ayuda",
] as const;

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

test.describe("Flujo 61: axe en las páginas públicas", () => {
  for (const viewport of VIEWPORTS) {
    test.describe(`viewport ${viewport.name}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      for (const path of PATHS) {
        test(`${path}: sin violaciones de axe`, async ({ page }) => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          const { violations } = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .analyze();
          // Regla, impacto y selectores; nunca el HTML entero
          const resumen = violations.map(
            (v) =>
              `${v.id} (${v.impact ?? "sin impacto"}): ${v.nodes
                .map((n) => n.target.join(" "))
                .join(" | ")}`,
          );
          expect(resumen, `Violaciones en ${path}`).toEqual([]);
        });
      }
    });
  }
});
