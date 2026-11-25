import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { MASCOTA_ALT } from "../lib/mascota";

/**
 * Flujo 263 (R27-06): lo que se ve fuera de la app, sin sesión. La portada con Afi saludando (con
 * prioridad y tamaño fijo, sin sacar el botón de la primera pantalla), el favicon con la cara y la
 * imagen para compartir (OG) en español y en inglés.
 */
test.describe("Flujo 263: portada, favicon e imagen para compartir", () => {
  for (const viewport of [
    { name: "celular", width: 390, height: 844 },
    { name: "computadora", width: 1280, height: 800 },
  ]) {
    test(`la portada muestra a Afi saludando con su alt (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      const afi = page.getByRole("img", { name: MASCOTA_ALT.saludando });
      await expect(afi).toBeVisible();
      // R28-01: sin prioridad alta, porque el LCP es el título y Afi en alta lo empeoraba (rendimiento.md)
      await expect(afi).not.toHaveAttribute("fetchpriority", "high");
      await expect(afi).toHaveAttribute("width", /^\d+$/);
      await expect(afi).toHaveAttribute("height", /^\d+$/);
      // La imagen cargó de verdad
      await expect
        .poll(() => afi.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      // «Pedir acceso» sigue en la primera pantalla
      const cta = page.getByRole("link", { name: "Pedir acceso" }).first();
      const box = await cta.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
    });
  }

  test("la portada no salta: Afi mide lo mismo antes y después de cargar", async ({ page }) => {
    await page.goto("/");
    const circulo = page.locator('[data-afi="saludando"]');
    const antes = await circulo.boundingBox();
    await page.waitForLoadState("networkidle");
    const despues = await circulo.boundingBox();
    expect(despues!.width).toBe(antes!.width);
    expect(despues!.height).toBe(antes!.height);
  });

  test("el favicon es la cara en PNG y el ícono de Apple también existe", async ({
    page,
    request,
  }) => {
    // Los PNG/ICO se copian a `app/` a mano (docs/beta/pasos-manuales-r27.md, «Favicon»): hasta
    // entonces se saltea; con la copia hecha corre solo.
    test.skip(!existsSync(join(__dirname, "..", "app", "icon.png")), "favicon sin copiar a app/");
    await page.goto("/");
    const icons = await page.locator('link[rel~="icon"]').evaluateAll((els) =>
      els.map((el) => ({
        href: (el as HTMLLinkElement).getAttribute("href") ?? "",
        type: el.getAttribute("type") ?? "",
      })),
    );
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.some((i) => /icon\.png/.test(i.href))).toBe(true);
    expect(icons.some((i) => /\.svg/.test(i.href) || i.type === "image/svg+xml")).toBe(false);
    for (const { href } of icons) {
      const res = await request.get(
        new URL(href, page.url()).pathname + new URL(href, page.url()).search,
      );
      expect(res.status(), href).toBe(200);
    }
    const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
    expect(apple).not.toBeNull();
    expect((await request.get(new URL(apple!, page.url()).pathname)).status()).toBe(200);
    // /favicon.ico, el que piden los navegadores sin leer el HTML
    const ico = await request.get("/favicon.ico");
    expect(ico.status()).toBe(200);
  });

  for (const [nombre, ruta] of [
    ["español", "/opengraph-image-es"],
    ["inglés", "/opengraph-image-en"],
  ] as const) {
    test(`la imagen para compartir en ${nombre} responde 200 image/png`, async ({ request }) => {
      const res = await request.get(ruta);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
      const body = await res.body();
      // Con Afi pesa bastante más que el texto solo (el PNG de la mascota va adentro)
      expect(body.length).toBeGreaterThan(60_000);
    });
  }
});
