import { expect, test } from "@playwright/test";

/**
 * Flujo 59 (ronda 96): /en/how-its-built pública, versión en inglés de /como-esta-hecho. Sin sesión
 * carga con h1 en inglés, contenedor lang="en", link de ida y vuelta, canonical y presencia en el sitemap.
 * Requiere que /en/how-its-built figure como ruta pública en auth.config.ts (carril rojo).
 */
test.describe("Flujo 59: how it's built (EN)", () => {
  test("carga sin sesión con h1 en inglés, lang=en y diagrama", async ({ page }) => {
    await page.goto("/en/how-its-built");
    await expect(page).toHaveURL(/\/en\/how-its-built$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("How it's built");
    await expect(page).toHaveTitle("How it's built");
    await expect(page.locator("div[lang='en']").first()).toBeVisible();
    await expect(page.getByRole("img", { name: /Journey of a job posting/ })).toHaveCount(1);
    await expect(page.getByRole("list", { name: "The journey, step by step" })).toBeVisible();
    await expect(page.getByTestId("pool-numbers")).toBeVisible();
    await expect(page.getByTestId("tests-count")).toContainText("automated tests");
    await expect(page.getByRole("link", { name: /GitHub repository/ })).toHaveAttribute(
      "href",
      "https://github.com/Malejo01/job-search-os",
    );
  });

  test("canonical y alternates apuntan a las dos versiones", async ({ page }) => {
    await page.goto("/en/how-its-built");
    await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
      "href",
      /\/en\/how-its-built$/,
    );
    await expect(page.locator("link[rel='alternate'][hreflang='es']")).toHaveAttribute(
      "href",
      /\/como-esta-hecho$/,
    );
    await expect(page.locator("link[rel='alternate'][hreflang='en']")).toHaveAttribute(
      "href",
      /\/en\/how-its-built$/,
    );
  });

  test("el link lleva a la española y vuelve", async ({ page }) => {
    await page.goto("/en/how-its-built");
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page).toHaveURL(/\/como-esta-hecho$/);
    await page.getByRole("link", { name: "English" }).click();
    await expect(page).toHaveURL(/\/en\/how-its-built$/);
  });

  test("está en el sitemap", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.ok()).toBe(true);
    expect(await res.text()).toContain("/en/how-its-built");
  });

  test("a 360 px no hay scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/en/how-its-built");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
