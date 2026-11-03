import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 102 (C7-9, manual P4): todas las pantallas con sesión a 390 px, en claro y en oscuro,
 * sin scroll horizontal, con el header tinta y el menú del celular. El tema se elige como lo
 * haría una persona (Ajustes guarda `jso-tema`), y se comprueba la clase `dark` en `<html>`.
 */
const PATHS = [
  "/hoy",
  "/jobs",
  "/jobs/pending-jd",
  "/jobs/new",
  "/inbox",
  "/applications",
  "/market",
  "/plan",
  "/encaje",
  "/cv",
  "/settings",
  "/settings/perfil",
  "/settings/skills",
  "/settings/historial",
  "/settings/senders",
  "/settings/criteria",
  "/settings/asistente",
  "/settings/invitations",
  "/settings/metricas",
] as const;

const THEMES = ["claro", "oscuro"] as const;

test.describe("Flujo 102: celular a 390 px en claro y oscuro", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const theme of THEMES) {
    test(`en ${theme}: ninguna pantalla con sesión tiene scroll horizontal`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), theme);
      await login(page);
      for (const path of PATHS) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first(), path).toBeVisible();
        if (theme === "oscuro") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
        // El header es índigo en los dos modos y el menú del celular está a mano
        await expect(page.locator("header").first()).toHaveCSS("background-color", "rgb(30, 27, 75)");
        await expect(page.getByTestId("menu-movil"), path).toBeVisible();
        const { scrollWidth, width } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          width: window.innerWidth,
        }));
        expect(scrollWidth, `scroll horizontal en ${path} (${theme})`).toBeLessThanOrEqual(width);
      }
    });
  }
});
