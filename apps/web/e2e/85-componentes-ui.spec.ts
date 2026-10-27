import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 85 (N3-3): los componentes base de `/ui` (Button, Card, Badge, EmptyState, Alert) sin
 * violaciones de axe en claro y en oscuro, a 360 y 1280 px. El oscuro se activa como lo haría una
 * persona: con la preferencia `jso-tema` en localStorage, que lee `app/theme-script.tsx` antes de
 * pintar. Así el spec prueba también que el script ponga la clase `dark` en `<html>`.
 */

const VIEWPORTS = [
  { name: "360x740", width: 360, height: 740 },
  { name: "1280x800", width: 1280, height: 800 },
] as const;

const THEMES = ["claro", "oscuro"] as const;

test.describe("Flujo 85: componentes base", () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`/ui en ${theme} a ${viewport.name}: sin violaciones de axe`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.addInitScript((value) => localStorage.setItem("jso-tema", value), theme);
        await login(page);
        await page.goto("/ui");
        await expect(page.getByRole("heading", { level: 1, name: "Componentes" })).toBeVisible();
        if (theme === "oscuro") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        await page.waitForLoadState("networkidle");
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `Violaciones en /ui (${theme}, ${viewport.name})`).toEqual([]);
        expect(unmeasured, `axe no midió el contraste en /ui (${theme})`).toEqual([]);
      });
    }
  }

  test("sin preferencia guardada, la app queda en claro aunque el sistema esté en oscuro", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await login(page);
    await page.goto("/ui");
    await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  });

  test("los botones tienen 44 px de alto y foco visible con teclado", async ({ page }) => {
    await login(page);
    await page.goto("/ui");
    const buttons = page.getByRole("button", {
      name: /^(primary|secondary|ghost|danger) (md|sm)$/,
    });
    await expect(buttons).toHaveCount(8);
    for (const button of await buttons.all()) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await button.focus();
      // focus() desde el test no siempre activa :focus-visible; Tab sí. Se enfoca el anterior y se tabula
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const outline = await button.evaluate((el) => {
        const css = getComputedStyle(el);
        return { style: css.outlineStyle, width: parseFloat(css.outlineWidth) };
      });
      expect(outline.style).toBe("solid");
      expect(outline.width).toBeGreaterThanOrEqual(2);
    }
  });
});
