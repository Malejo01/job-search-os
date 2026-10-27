import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 88 (N3): axe en modo oscuro de las pantallas ya migradas a los tokens (docs/ux/tokens.md).
 * Cada PR que migra una pantalla la suma a `ROUTES`. El oscuro se activa con la preferencia
 * `jso-tema` en localStorage, como lo haría una persona; el claro ya lo cubre el flujo 70.
 */

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

const ROUTES = ["/hoy", "/jobs"] as const;

test.describe("Flujo 88: axe en oscuro", () => {
  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${route} a ${viewport.name}: sin violaciones de axe en oscuro`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
        await login(page);
        await page.goto(route);
        await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `Violaciones en ${route} (oscuro, ${viewport.name})`).toEqual([]);
        expect(unmeasured, `axe no midió el contraste en ${route} (oscuro)`).toEqual([]);
      });
    }
  }
});
