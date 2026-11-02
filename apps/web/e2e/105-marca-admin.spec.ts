import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { login } from "./helpers";

/**
 * Flujo 105 (reserva R-1): /settings/marca, la vitrina de marca para revisar, solo para quien
 * administra la beta (en el CI, la cuenta del e2e está en ADMIN_EMAILS). Claro y oscuro van lado a
 * lado en la misma página, así que un solo pase de axe revisa los dos.
 */
test.describe("Flujo 105: vitrina de marca", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  for (const width of [390, 1280]) {
    test(`a ${width} px: logo, paleta en los dos modos y sin violaciones de axe`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await login(page);
      await page.goto("/settings");
      await page.getByRole("link", { name: /^Marca/ }).click();
      await expect(page).toHaveURL(/\/settings\/marca$/);
      await expect(page.getByRole("heading", { level: 1, name: "Marca" })).toBeVisible();
      const light = page.getByRole("region", { name: "Claro" });
      const dark = page.getByRole("region", { name: "Oscuro" });
      await expect(light).toBeVisible();
      await expect(dark).toBeVisible();
      // Los valores salen de globals.css: la superficie es blanca en claro y #121212 en oscuro
      await expect(light.getByText("#FFFFFF").first()).toBeVisible();
      await expect(dark.getByText("#121212").first()).toBeVisible();
      await page.waitForLoadState("networkidle");
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
    });
  }
});
