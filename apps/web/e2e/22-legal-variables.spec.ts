import { expect, test } from "@playwright/test";

// Sin sesión y sin LEGAL_* en el entorno de e2e: los datos legales salen como "en revisión" (JS-120)
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("datos legales por variables (JS-120)", () => {
  for (const url of ["/legal/privacidad", "/legal/terminos"]) {
    test(`${url} muestra "en revisión" y ningún marcador entre corchetes`, async ({ page }) => {
      const response = await page.goto(url);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).not.toBe("/login");
      const texto = (await page.locator("article").innerText()) ?? "";
      expect(texto).toContain("en revisión");
      for (const marcador of ["[RESPONSABLE]", "[DOMICILIO]", "[EMAIL DE CONTACTO]"]) {
        expect(texto).not.toContain(marcador);
      }
      expect(texto).not.toContain("plazo de retención de los logs]");
    });
  }
});
