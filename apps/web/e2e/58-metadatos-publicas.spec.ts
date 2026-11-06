import { expect, test } from "@playwright/test";

/**
 * Flujo 58 (ronda 93): metadatos de las páginas públicas, sin sesión. Título, descripción, URL
 * canónica e imagen para compartir en cada página. Las páginas son ISR y pueden estar vacías: se
 * miran los metadatos, nunca cantidades.
 */
const PATHS = [
  "/",
  "/mercado",
  "/mercado/data_analyst",
  "/ofertas",
  "/demo",
  "/como-esta-hecho",
  "/en/how-its-built",
  "/acceso",
  "/ayuda",
] as const;

test.describe("Flujo 58: metadatos de las páginas públicas", () => {
  for (const path of PATHS) {
    test(`${path}: título, descripción, canónica e imagen para compartir`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(/\S/);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
      const href = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(href, "canónica").not.toBeNull();
      expect(new URL(href!).pathname).toBe(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /\S/);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\S/);
      // Las páginas en inglés comparten su propia imagen
      if (path.startsWith("/en/")) {
        await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
          "content",
          /opengraph-image-en/,
        );
      }
      // og:url = la canónica (un openGraph de página reemplaza al del layout: no puede faltar)
      const ogUrl = await page.locator('meta[property="og:url"]').getAttribute("content");
      expect(ogUrl, "og:url").not.toBeNull();
      expect(new URL(ogUrl!).pathname).toBe(path);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        "content",
        "summary_large_image",
      );
    });
  }
});
