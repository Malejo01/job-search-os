import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 262 (R27-05): la cabecera de Academy lleva a la mascota explicando. Con la persona B (ficticia). La
 * figura es decorativa: el título y la bajada de al lado dicen lo mismo.
 */
test.describe("Flujo 262: Academy con la mascota explicando (R27-05)", () => {
  test.beforeAll(ensureSecondUser);
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("la cabecera de Academy tiene a `explicando`, decorativa", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto("/academy");
    await expect(page.getByRole("heading", { level: 1, name: "Academy" })).toBeVisible();
    const figura = page.locator('[data-afi="explicando"]').first();
    await expect(figura).toBeVisible();
    await expect(figura).toHaveAttribute("aria-hidden", "true");
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
  });
});
