import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 121 (C10): el botón de claro y oscuro de la barra, con sesión y sin sesión. Cambia el modo
 * en el momento, lo deja guardado (el mismo `localStorage` que «Apariencia» de Ajustes) y su nombre
 * dice a qué modo pasa.
 */
test.describe("Flujo 121: cambiar entre claro y oscuro desde la barra", () => {
  test("sin sesión, en la portada: pasa a oscuro, queda guardado y vuelve a claro", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("c10-tema")) {
        localStorage.setItem("jso-tema", "claro");
        sessionStorage.setItem("c10-tema", "1");
      }
    });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: "Pasar a modo oscuro" }).click();
    await expect(html).toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem("jso-tema"))).toBe("oscuro");
    await page.reload();
    await expect(html).toHaveClass(/\bdark\b/);
    await page.getByRole("button", { name: "Pasar a modo claro" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
    expect(await page.evaluate(() => localStorage.getItem("jso-tema"))).toBe("claro");
  });

  for (const width of [390, 1280]) {
    test(`con sesión a ${width} px: el botón está en la barra y mide 44 px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => localStorage.setItem("jso-tema", "claro"));
      await login(page);
      const toggle = page.locator("header").getByRole("button", { name: "Pasar a modo oscuro" });
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await toggle.click();
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    });
  }
});
