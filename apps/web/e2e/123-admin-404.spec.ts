import { expect, test } from "@playwright/test";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 123 (R4-09, hallazgos 23 y 24): las pantallas de administración y el catálogo interno de
 * componentes dan 404 a una cuenta común, igual que /settings/marca.
 */
test.describe("Flujo 123: pantallas de admin con cuenta común", () => {
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  for (const path of ["/ui", "/settings/planes", "/settings/invitations", "/settings/marca"]) {
    test(`${path} responde 404 a quien no administra la beta`, async ({ page }) => {
      await ensureSecondUser();
      await loginAsSecondUser(page);
      const res = await page.goto(path);
      expect(res?.status()).toBe(404);
      await expect(page.getByText("Tu cuenta no puede")).toHaveCount(0);
    });
  }
});
