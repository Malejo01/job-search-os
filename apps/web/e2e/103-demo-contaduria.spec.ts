import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";

/**
 * Flujo 103 (C7-13): la demo de contaduría, sin sesión y en el celular. Datos inventados y fijos:
 * el perfil, las ofertas con su puntaje y por qué sí y por qué no, y una oferta sin descripción
 * donde se puede pegar texto sin que se guarde nada.
 */
test.describe("Flujo 103: demo de contaduría", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sin sesión: perfil, Hoy, detalle con puntajes y la oferta sin descripción", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page.getByTestId("demo-contaduria-link").click();
    await expect(page).toHaveURL(/\/demo\/contaduria$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Así se ve para alguien de contaduría" }),
    ).toBeVisible();
    await expect(page.getByText("Ejemplo con datos inventados")).toBeVisible();

    const offers = page.getByTestId("demo-contaduria-oferta");
    await expect(offers).toHaveCount(4);
    await expect(offers.first().getByRole("img", { name: "puntaje 8.5" })).toBeVisible();
    await expect(offers.first().getByRole("heading", { name: "A tu favor" })).toBeVisible();
    await expect(offers.last()).toContainText("Te frena");

    // La oferta sin descripción: el contador cuenta y el botón no guarda nada
    const box = page.getByLabel("Descripción del puesto");
    await box.fill("x".repeat(250));
    await expect(page.getByTestId("demoJd-counter")).toContainText("250");
    await page.getByRole("button", { name: "Guardar descripción y evaluar" }).click();
    await expect(page.getByRole("status").filter({ hasText: "no se guarda nada" })).toBeVisible();

    const { scrollWidth, width } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      width: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(width);
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`axe en ${tema}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/demo/contaduria");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations, `axe en ${tema}`).toEqual([]);
      expect(unmeasured).toEqual([]);
    });
  }
});
