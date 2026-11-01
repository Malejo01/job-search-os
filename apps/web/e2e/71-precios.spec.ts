import { expect, test } from "@playwright/test";
import { login } from "./helpers";

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

  test("con los precios encendidos, muestra el plan gratis y el de la beta, sin garantía (C3-1)", async ({
    page,
  }) => {
    test.skip(!ON, "PRICING_ENABLED apagado en este entorno");
    await page.setViewportSize({ width: 360, height: 740 });
    const response = await page.goto("/precios");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Precios" })).toBeVisible();
    // Solo se ofrecen los dos planes de la beta: los viejos siguen válidos en la base, pero no se muestran
    for (const key of ["gratis", "lista"]) {
      await expect(page.getByTestId(`plan-${key}`)).toBeVisible();
    }
    for (const key of ["fundador", "pase_3_meses"]) {
      await expect(page.getByTestId(`plan-${key}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("precio-gratis")).toHaveText("Gratis");
    await expect(page.getByTestId("precio-lista")).toHaveText(/^\$ 20[.\s]?000 por mes$/);
    await expect(page.getByTestId("referencia-lista")).toContainText("USD 15 como referencia");
    await expect(page.getByText(/garant/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Pedí acceso" })).toHaveAttribute(
      "href",
      "/acceso",
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("«Tu plan» en Ajustes aparece solo con los precios encendidos (C-11b)", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Ajustes" })).toBeVisible();
    if (ON) {
      // La cuenta del e2e no tiene plan pago: rige el gratis
      await expect(page.getByTestId("tu-plan")).toContainText("Gratis");
    } else {
      await expect(page.getByTestId("tu-plan")).toHaveCount(0);
    }
  });
});
