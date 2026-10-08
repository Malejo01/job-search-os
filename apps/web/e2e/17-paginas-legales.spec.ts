import { expect, test } from "@playwright/test";

// Sin sesión: las páginas legales se leen antes de registrarse (JS-106)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("páginas legales públicas (JS-106)", () => {
  const casos = [
    { url: "/legal/privacidad", titulo: /Política de privacidad/ },
    { url: "/legal/terminos", titulo: /Términos de uso/ },
    { url: "/privacidad", titulo: /Política de privacidad/ },
    { url: "/terminos", titulo: /Términos de uso/ },
  ];

  for (const { url, titulo } of casos) {
    test(`${url} responde 200 con el texto y sin pasar por /login`, async ({ page }) => {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).not.toBe("/login");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(titulo);
      await expect(page.getByRole("note")).toContainText("Borrador en revisión");
    });
  }

  test("el layout público enlaza a /login y a la otra página", async ({ page }) => {
    await page.goto("/legal/privacidad");
    await expect(page.getByRole("link", { name: "Entrar" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Términos" })).toHaveAttribute(
      "href",
      "/legal/terminos",
    );
  });
});
