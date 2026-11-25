import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";
import { reach } from "./teclado-helpers";

/**
 * Flujo 299 (R28-08): el panel /admin solo con teclado. Las secciones del panel se alcanzan con Tab con el foco
 * visible y la actual lleva `aria-current="page"`; «Saltar al contenido» lleva el foco a `main`. Con el usuario
 * del seed (admin en el e2e). Sin `ADMIN_EMAILS` la cuenta del e2e no es admin: se saltea (corre en el CI).
 */
test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Flujo 299: panel /admin con teclado (R28-08)", () => {
  test.skip(
    !process.env.ADMIN_EMAILS,
    "sin ADMIN_EMAILS la cuenta del e2e no es admin (corre en el CI)",
  );

  test.beforeAll(async () => {
    await ensureSeedPerson();
  });

  test("recorrer las secciones del panel con Tab y saltar al contenido", async ({ page }) => {
    await login(page);
    await page.goto("/admin");
    await expect(page.locator("main#contenido")).toBeAttached();

    const nav = page.getByRole("navigation", { name: "Secciones del panel de administración" });
    const enlaces = nav.getByRole("link");
    const total = await enlaces.count();
    expect(total, "el panel tiene secciones").toBeGreaterThan(1);
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    // La navegación va antes del contenido: cada enlace, en orden, con el foco visible
    for (let i = 0; i < Math.min(total, 6); i += 1) {
      await reach(page, enlaces.nth(i), `sección ${i + 1} del panel`);
    }

    // Pantalla recién cargada: el primer Tab es el salto
    await page.goto("/admin");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#contenido")).toBeFocused();
  });
});
