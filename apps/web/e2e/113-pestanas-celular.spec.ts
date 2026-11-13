import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 113 (R-3 de C8; C9-7): pestañas fijas abajo en el celular. Desde el rediseño van siempre
 * (sin variable) y reemplazan al «Menú» de arriba: Hoy, Ofertas, Postulaciones, Mi CV y Perfil, la
 * activa en lima. Lo que no entra en las cinco está en Perfil, dentro de «Más».
 */
test.describe("Flujo 113: pestañas del celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("cinco pestañas, sin «Menú» arriba, la activa marcada y el chip por encima", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const bar = page.getByTestId("tabbar");
    await expect(bar).toBeVisible();
    await expect(page.getByTestId("menu-movil")).toHaveCount(0);
    await expect(bar.getByRole("link")).toHaveCount(5);
    await expect(bar.getByRole("link", { name: "Ofertas" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // La pestaña activa lleva el ícono en una píldora lima (C10-3)
    await expect(bar.getByRole("link", { name: "Ofertas" }).getByTestId("tab-icono")).toHaveCSS(
      "background-color",
      "rgb(198, 242, 91)",
    );
    const chip = await page.getByRole("button", { name: "¿Algo no anduvo?" }).boundingBox();
    const barBox = await bar.boundingBox();
    expect(chip!.y + chip!.height).toBeLessThanOrEqual(barBox!.y);
    for (const tema of ["claro", "oscuro"]) {
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/hoy");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations, tema).toEqual([]);
      expect(unmeasured, tema).toEqual([]);
    }
  });

  test("las pestañas y «Más» llegan a todas las secciones", async ({ page }) => {
    await login(page);
    const bar = page.getByTestId("tabbar");
    const tabs: Array<[string, string]> = [
      ["Hoy", "/hoy"],
      ["Ofertas", "/jobs"],
      ["Postulaciones", "/applications"],
      ["Mi CV", "/cv"],
      ["Perfil", "/settings/perfil"],
    ];
    for (const [label, path] of tabs) {
      await bar.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL(`**${path}`);
      await expect(bar.getByRole("link", { name: label, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
      await expect(bar.locator('a[aria-current="page"]')).toHaveCount(1);
    }
    // R5-C9: «Sin descripción» es trabajo con las ofertas: desde «Más» marca Ofertas; el resto, Perfil
    const more: Array<[string, string, string]> = [
      ["Sin descripción", "/jobs/pending-jd", "Ofertas"],
      ["Emails", "/inbox", "Perfil"],
      ["Mercado", "/market", "Perfil"],
      ["Plan", "/plan", "Perfil"],
      ["Ajustes", "/settings", "Perfil"],
    ];
    for (const [label, path, activeTab] of more) {
      await page.goto("/settings/perfil");
      await page
        .getByTestId("mas")
        .getByRole("link", { name: new RegExp(`^${label}`) })
        .click();
      await page.waitForURL(`**${path}`);
      await expect(bar.getByRole("link", { name: activeTab, exact: true })).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    // /encaje es del grupo de Mercado y Plan: marca Perfil
    await page.goto("/encaje");
    await expect(bar.getByRole("link", { name: "Perfil", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // El glosario está en «Más» y lleva a /ayuda
    await page.goto("/settings/perfil");
    await page
      .getByTestId("mas")
      .getByRole("link", { name: /^Glosario/ })
      .click();
    await page.waitForURL("**/ayuda#glosario");
    await expect(page.getByRole("heading", { name: /Glosario/ })).toBeVisible();
  });
});
