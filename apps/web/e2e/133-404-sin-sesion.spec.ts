import { expect, test } from "@playwright/test";
import { login } from "./helpers";

/**
 * Flujo 133 (R9-4): una URL que no existe muestra el 404 del sitio, con sesión y sin sesión; las
 * rutas privadas que sí existen siguen mandando al login sin sesión (incluido un detalle con id
 * inventado, porque `/jobs` existe). Todo inventado, sin datos de personas.
 */
const SIN_SESION = { cookies: [], origins: [] };

test.describe("Flujo 133: 404 sin sesión", () => {
  test.describe("sin sesión", () => {
    test.use({ storageState: SIN_SESION });

    test("una URL inventada da 404 con el 404 del sitio", async ({ page }) => {
      const response = await page.goto("/esta-pagina-no-existe");
      expect(response?.status()).toBe(404);
      expect(new URL(page.url()).pathname).toBe("/esta-pagina-no-existe");
      await expect(page.getByText("No encontramos esta página")).toBeVisible();
      // La salida no lleva al login: sin sesión es la portada
      await page.getByRole("link", { name: "Ir al inicio" }).click();
      await expect(page).toHaveURL(/\/$/);
    });

    test("un POST de Server Action a una ruta inventada no pasa sin sesión", async ({
      request,
    }) => {
      const res = await request.post("/esta-pagina-no-existe", {
        headers: { "next-action": "00", "content-type": "text/plain;charset=UTF-8" },
        data: "[]",
        maxRedirects: 0,
      });
      expect([302, 303, 307, 308]).toContain(res.status());
      expect(res.headers()["location"] ?? "").toMatch(/\/login/);
    });

    test("una ruta privada que existe sigue yendo al login", async ({ page }) => {
      await page.goto("/hoy");
      await expect(page).toHaveURL(/\/login/);
    });

    test("el detalle de una ruta privada con un id inventado también va al login", async ({
      page,
    }) => {
      await page.goto("/jobs/00000000-0000-4000-8000-000000000000");
      await expect(page).toHaveURL(/\/login/);
      await page.goto("/inbox/00000000-0000-4000-8000-000000000000");
      await expect(page).toHaveURL(/\/login/);
    });

    test("no se esquiva con mayúsculas ni porcentajes", async ({ page }) => {
      await page.goto("/%6Aobs");
      await expect(page).toHaveURL(/\/login/);
    });

    test("las páginas públicas siguen abiertas", async ({ page }) => {
      for (const path of ["/", "/acceso", "/ayuda", "/login"]) {
        const response = await page.goto(path);
        expect(response?.status(), path).toBe(200);
        expect(new URL(page.url()).pathname, path).toBe(path);
      }
    });
  });

  test("con sesión, una URL inventada también da 404", async ({ page }) => {
    await login(page);
    const response = await page.goto("/esta-pagina-no-existe");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("No encontramos esta página")).toBeVisible();
    // Con sesión, «Ir al inicio» termina en Hoy
    await page.getByRole("link", { name: "Ir al inicio" }).click();
    await expect(page).toHaveURL(/\/hoy/);
  });
});
