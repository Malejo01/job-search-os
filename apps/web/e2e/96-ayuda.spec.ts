import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";

test.describe("Flujo 96: Página pública de ayuda y preguntas frecuentes (/ayuda)", () => {
  test("contenido completo, enlaces clave y navegación desde el pie", async ({ page }) => {
    // 1. Navegar desde la portada y verificar enlace en el pie
    await page.goto("/");
    const footerLink = page.locator("footer").getByRole("link", { name: "Preguntas frecuentes" });
    await expect(footerLink).toBeVisible();
    await footerLink.click();
    await expect(page).toHaveURL(/\/ayuda$/);

    // 2. Título principal
    await expect(
      page.getByRole("heading", { level: 1, name: "Preguntas frecuentes" }),
    ).toBeVisible();

    // 3. Preguntas clave requeridas para la beta
    const expectedQuestions = [
      "¿Qué es la app?",
      "¿Para quién es esta beta cerrada?",
      "¿Cómo me anoto?",
      "¿Cuándo abre el acceso?",
      "¿Cuánto cuesta?",
      "¿Qué hace y qué NO hace la app?",
      "¿Qué pasa con mis datos y mi privacidad?",
      "¿Cómo aviso si algo no funciona o tengo una consulta?",
      "¿Cómo me doy de baja si no quiero usar más la app?",
      "¿Necesito conocimientos técnicos o saber de programación?",
    ];

    for (const q of expectedQuestions) {
      await expect(page.getByRole("heading", { level: 2, name: q })).toBeVisible();
    }

    // 4. Mención de las 6 carreras y fecha clave
    const body = page.locator("main");
    await expect(body).toContainText("Abogacía");
    await expect(body).toContainText("Contaduría, impuestos y finanzas");
    await expect(body).toContainText("Administración de empresas");
    await expect(body).toContainText("Comunicación");
    await expect(body).toContainText("Marketing digital y relaciones públicas");
    await expect(body).toContainText("Relaciones internacionales");
    await expect(body).toContainText("jueves 26 de noviembre");

    // 5. Enlaces internos correctos
    await expect(body.getByRole("link", { name: "Pedir acceso" }).first()).toHaveAttribute(
      "href",
      "/acceso",
    );
    await expect(body.getByRole("link", { name: "Precios" })).toHaveAttribute("href", "/precios");
    await expect(body.getByRole("link", { name: "Política de privacidad" })).toHaveAttribute(
      "href",
      "/legal/privacidad",
    );
  });

  test("axe en claro (360x740 y 1280x800) sin violaciones", async ({ page }) => {
    for (const vp of [
      { width: 360, height: 740 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto("/ayuda");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");

      const { violations, unmeasured } = await axeSummary(page);
      expect(violations, `Violaciones en claro (${vp.width}x${vp.height})`).toEqual([]);
      expect(unmeasured, `Contraste no medido en claro (${vp.width}x${vp.height})`).toEqual([]);
    }
  });

  test("axe en oscuro (360x740 y 1280x800) sin violaciones", async ({ page }) => {
    for (const vp of [
      { width: 360, height: 740 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      await page.addInitScript(() => localStorage.setItem("jso-tema", "oscuro"));
      await page.goto("/ayuda");
      await expect(page.locator("html")).toHaveClass(/\bdark\b/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");

      const { violations, unmeasured } = await axeSummary(page);
      expect(violations, `Violaciones en oscuro (${vp.width}x${vp.height})`).toEqual([]);
      expect(unmeasured, `Contraste no medido en oscuro (${vp.width}x${vp.height})`).toEqual([]);
    }
  });
});
