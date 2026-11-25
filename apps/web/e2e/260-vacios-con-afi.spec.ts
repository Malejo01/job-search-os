import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 260 (R27-05): los vacíos llevan a la mascota en la pose que corresponde (ya no el monograma). Con la
 * persona B (ficticia, sin datos): Match sin ofertas con `trabajando`, Tracker con `analizando` e Interview con
 * `quieto`. La figura es decorativa (el texto de al lado lo dice) y no hay violaciones serias de axe.
 */
test.describe("Flujo 260: vacíos con la mascota (R27-05)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("Match, Tracker e Interview vacíos con su pose", async ({ page }) => {
    await loginAsSecondUser(page);
    const casos = [
      { ruta: "/jobs", testId: "jobs-empty-none", pose: "trabajando" },
      { ruta: "/applications", testId: null, pose: "analizando" },
      { ruta: "/interview", testId: "interview-vacio", pose: "quieto" },
    ] as const;
    for (const caso of casos) {
      await page.goto(caso.ruta);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      const raiz = caso.testId ? page.getByTestId(caso.testId) : page.locator("main");
      const figura = raiz.locator(`[data-afi="${caso.pose}"]`).first();
      await expect(figura, caso.ruta).toBeAttached();
      // Decorativa: oculta para lectores de pantalla y sin texto alternativo
      await expect(figura).toHaveAttribute("aria-hidden", "true");
      await expect(figura.locator("img")).toHaveAttribute("alt", "");
      const { violations } = await axeSummary(page);
      expect(violations, caso.ruta).toEqual([]);
    }
  });

  test("a 390 px de ancho el vacío de Match no desborda", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsSecondUser(page);
    await page.goto("/jobs");
    await expect(page.getByTestId("jobs-empty-none")).toBeVisible();
    const sobra = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(sobra).toBeLessThanOrEqual(0);
  });
});
