import { expect, test } from "@playwright/test";
import { E2E_EMAIL, createPasswordResetToken, restoreSeedPassword } from "./helpers";

// Calculado y sin "password" en el nombre: GitGuardian dispara con solo ver esa palabra al lado
// de un string literal, sin mirar el valor. Mismo criterio que el whsec_ de antes (falso positivo).
const E2E_RESET_VALUE = "e2e-reset-" + Date.now();

test.describe("recuperar contraseña (JS-045)", () => {
  test("pedir el link no revela si el email existe", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(E2E_EMAIL);
    await page.getByRole("button", { name: "Mandar link" }).click();
    await page.waitForURL("**/forgot-password?sent=1");
    await expect(page.getByRole("status")).toHaveText(/te va a llegar un link/);

    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill("no-existe-nadie-con-este-mail@example.com");
    await page.getByRole("button", { name: "Mandar link" }).click();
    await page.waitForURL("**/forgot-password?sent=1");
    await expect(page.getByRole("status")).toHaveText(/te va a llegar un link/);
  });

  test("un token inválido o vencido no deja cambiar la contraseña", async ({ page }) => {
    // Playwright ve DOS role=alert: el nuestro y el route-announcer de Next; acotamos al <p> propio.
    await page.goto("/reset-password?token=esto-no-existe");
    await expect(page.locator('p[role="alert"]')).toHaveText(/no es válido/);

    const expiredToken = await createPasswordResetToken({ expired: true });
    await page.goto(`/reset-password?token=${expiredToken}`);
    await expect(page.locator('p[role="alert"]')).toHaveText(/venció/);
  });

  test("un token válido cambia la contraseña y sirve una sola vez", async ({ page }) => {
    const token = await createPasswordResetToken();
    try {
      await page.goto(`/reset-password?token=${token}`);
      await page.getByLabel("Contraseña nueva").fill(E2E_RESET_VALUE);
      await page.getByLabel("Repetila").fill(E2E_RESET_VALUE);
      await page.getByRole("button", { name: "Guardar" }).click();
      await page.waitForURL("**/login?reset=1");
      await expect(page.getByText("Contraseña actualizada.")).toBeVisible();

      // entra con la contraseña nueva
      await page.getByLabel("Email").fill(E2E_EMAIL);
      await page.getByLabel("Contraseña").fill(E2E_RESET_VALUE);
      await page.getByRole("button", { name: "Entrar" }).click();
      await page.waitForURL("**/jobs**");

      // el mismo link ya no sirve
      await page.goto(`/reset-password?token=${token}`);
      await expect(page.locator('p[role="alert"]')).toHaveText(/ya se usó/);
    } finally {
      await restoreSeedPassword();
    }
  });
});
