import { expect, test } from "@playwright/test";

/**
 * Flujo 71 (C-12): página pública de precios detrás de `PRICING_ENABLED`. El servidor del e2e hereda
 * el entorno del runner, así que el test mira la misma variable: en el CI está apagada (404 y fuera
 * del sitemap); con `PRICING_ENABLED=1` verifica la página encendida, sin sesión y a 360 px.
 */
const ON = process.env.PRICING_ENABLED === "1";

test.describe("Flujo 71: precios", () => {
  test("con los precios apagados, /precios da 404 y no está en el sitemap", async ({ request }) => {
    test.skip(ON, "PRICING_ENABLED=1 en este entorno");
    expect((await request.get("/precios")).status()).toBe(404);
    expect(await (await request.get("/sitemap.xml")).text()).not.toContain("/precios");
  });

  test("con los precios encendidos, muestra los cuatro planes sin cifras inventadas", async ({
    page,
  }) => {
    test.skip(!ON, "PRICING_ENABLED apagado en este entorno");
    await page.setViewportSize({ width: 360, height: 740 });
    const response = await page.goto("/precios");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Precios" })).toBeVisible();
    for (const key of ["gratis", "fundador", "lista", "pase_3_meses"]) {
      await expect(page.getByTestId(`plan-${key}`)).toBeVisible();
    }
    await expect(page.getByTestId("precio-gratis")).toHaveText("Gratis");
    await expect(page.getByRole("heading", { name: /Garantía de 14 días/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pedí acceso" })).toHaveAttribute(
      "href",
      "/acceso",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });
});
