import { expect, test } from "@playwright/test";
import { E2E_EMAIL, login } from "./helpers";

/**
 * Flujo 39 (ronda 55): el link "Invitar" del header solo lo ve quien puede crear invitaciones
 * (ADMIN_EMAILS). El caso admin depende de que el entorno de e2e tenga el email del usuario de
 * e2e en ADMIN_EMAILS; si no, se saltea.
 */
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const e2eIsAdmin = adminEmails.includes(E2E_EMAIL.toLowerCase());

test.describe("Flujo 39: Invitar visible en el header", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("39a. un usuario común no ve Invitar", async ({ page }) => {
    test.skip(e2eIsAdmin, "El usuario de e2e es admin en este entorno: no es un usuario común");
    await login(page);
    await expect(page.getByRole("link", { name: "Ajustes" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Invitar", exact: true })).toHaveCount(0);
  });

  test("39b. un admin ve Invitar y lleva a /settings/invitations", async ({ page }) => {
    test.skip(!e2eIsAdmin, "ADMIN_EMAILS no incluye al usuario de e2e en este entorno");
    await login(page);
    const link = page.getByRole("link", { name: "Invitar", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL("**/settings/invitations");
  });
});
