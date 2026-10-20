import { expect, test } from "@playwright/test";

/**
 * Flujo 49 (ronda 75): /como-esta-hecho pública. Sin sesión carga, con un solo h1, el diagrama con
 * nombre accesible, el link al repo, los números del pool (estructura, no cantidades: la página es
 * ISR y puede haberse prerenderizado sin datos), sin scroll horizontal a 360 px y sin nombre de producto.
 */
test.describe("Flujo 49: cómo está hecho", () => {
  test("carga sin sesión con h1, diagrama, link al repo y números", async ({ page }) => {
    await page.goto("/como-esta-hecho");
    await expect(page).toHaveURL(/\/como-esta-hecho$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cómo está hecho");
    await expect(page).toHaveTitle("Cómo está hecho");
    expect(await page.title()).not.toContain("Job Search OS");

    // Solo un SVG visible por viewport, con nombre accesible
    const diagram = page.getByRole("img", { name: /Recorrido de una oferta/ });
    await expect(diagram).toHaveCount(1);
    await expect(page.getByRole("list", { name: "El recorrido, paso a paso" })).toBeVisible();

    const repo = page.getByRole("link", { name: /Repositorio en GitHub/ });
    await expect(repo).toHaveAttribute("href", "https://github.com/Malejo01/job-search-os");
    await expect(repo).toHaveAttribute("rel", /noopener/);

    await expect(page.getByTestId("pool-numbers")).toBeVisible();
    await expect(page.getByTestId("tests-count")).toContainText("tests automatizados");
  });

  test("a 360 px no hay scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/como-esta-hecho");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("el link del pie y el de la portada llevan a la página", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Mirá cómo está hecho/ }).click();
    await expect(page).toHaveURL(/\/como-esta-hecho$/);
    await expect(
      page.getByRole("contentinfo").getByRole("link", { name: "Cómo está hecho" }),
    ).toBeVisible();
  });
});
