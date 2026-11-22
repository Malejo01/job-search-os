import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 113 (R-3 de C8; C9-7): pestañas fijas abajo en el celular. Desde el rediseño van siempre
 * (sin variable) y reemplazan al «Menú» de arriba: Hoy, Match, CV, Tracker e Interview, la
 * activa en lima. Lo que no entra en las cinco (Academy, Perfil, Ajustes) está en «Más», dentro de
 * Perfil, al que se llega por el avatar.
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
    await expect(bar.getByRole("link", { name: "Match" })).toHaveAttribute("aria-current", "page");
    // La pestaña activa lleva el ícono en una píldora lima (C10-3)
    await expect(bar.getByRole("link", { name: "Match" }).getByTestId("tab-icono")).toHaveCSS(
      "background-color",
      "rgb(198, 242, 91)",
    );
    // R11-13: en el celular el chip ya no flota; va al final de la página, en el flujo (ver spec 134)
    await expect(page.getByTestId("feedback-inline")).toBeAttached();
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
      ["Match", "/jobs"],
      ["CV", "/cv"],
      ["Tracker", "/applications"],
      ["Interview", "/interview"],
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
    // El avatar lleva a Perfil, que tiene «Más». «Sin descripción» es trabajo con las ofertas:
    // marca Match; el resto de «Más» no marca ninguna pestaña
    await page.goto("/hoy");
    await page
      .locator("header")
      .getByRole("link", { name: /^Perfil/ })
      .click();
    await page.waitForURL("**/settings/perfil");
    const more: Array<[string, string, string | null]> = [
      ["Academy", "/academy", null],
      ["Sin descripción", "/jobs/pending-jd", "Match"],
      ["Emails", "/inbox", null],
      ["Mercado", "/market", null],
      ["Plan", "/plan", null],
      ["Ajustes", "/settings", null],
    ];
    for (const [label, path, activeTab] of more) {
      await page.goto("/settings/perfil");
      await page
        .getByTestId("mas")
        .getByRole("link", { name: new RegExp(`^${label}`) })
        .click();
      await page.waitForURL(`**${path}`);
      if (activeTab) {
        await expect(bar.getByRole("link", { name: activeTab, exact: true })).toHaveAttribute(
          "aria-current",
          "page",
        );
      } else {
        await expect(bar.locator('a[aria-current="page"]')).toHaveCount(0);
      }
    }
    // /encaje es del grupo de Mercado y Plan: no marca ninguna pestaña
    await page.goto("/encaje");
    await expect(bar.locator('a[aria-current="page"]')).toHaveCount(0);
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
