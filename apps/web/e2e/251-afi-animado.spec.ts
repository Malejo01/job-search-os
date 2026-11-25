import { expect, test, type Locator } from "@playwright/test";
import { abrirPanel, afiSetup } from "./afi-helpers";

/**
 * Flujo 251 (R27-02): Afi animado. Se monta en el panel del asistente (R27-03), así que se prueba ahí con la
 * persona B. Con `prefers-reduced-motion: reduce` Afi queda quieto: sin transform animado ni transiciones.
 * Sin movimiento reducido el contenedor anima (marca `data-movimiento="completo"`).
 */
afiSetup();

const transformDe = (el: Locator) => el.evaluate((n) => getComputedStyle(n).transform);

test.describe("Flujo 251: Afi animado (R27-02)", () => {
  test.describe("con movimiento reducido", () => {
    test.use({ reducedMotion: "reduce" });

    test("Afi queda quieto: sin transform ni transición, y no cambia entre dos lecturas", async ({
      page,
    }) => {
      const { panel } = await abrirPanel(page);
      const afi = panel.locator("[data-afi-animado]");
      await expect(afi).toHaveCount(1);
      await expect(afi).toHaveAttribute("data-movimiento", "reducido");
      const primera = await transformDe(afi);
      expect(primera === "none" || primera === "matrix(1, 0, 0, 1, 0, 0)").toBe(true);
      await page.waitForTimeout(500);
      expect(await transformDe(afi)).toBe(primera);
      // Ni el contenedor ni la imagen tienen transiciones o animaciones
      const animado = await afi.evaluate((n) => {
        const todos = [n, ...Array.from(n.querySelectorAll("*"))];
        return todos.some((e) => {
          const cs = getComputedStyle(e);
          return (
            cs.animationName !== "none" || (cs.transitionDuration.split(",")[0] ?? "0s") !== "0s"
          );
        });
      });
      expect(animado).toBe(false);
      await expect(afi.locator("[data-afi]")).toHaveAttribute("data-afi", "quieto");
    });
  });

  test.describe("con movimiento normal", () => {
    test.use({ reducedMotion: "no-preference" });

    test("el contenedor se marca como animado y nunca hay más de un Afi animado", async ({
      page,
    }) => {
      const { panel } = await abrirPanel(page);
      await expect(panel.locator("[data-afi-animado]")).toHaveAttribute(
        "data-movimiento",
        "completo",
      );
      await expect(page.locator("[data-afi-animado]")).toHaveCount(1);
    });
  });
});
