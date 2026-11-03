import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, login, loginAsSecondUser, removeSecondUser } from "./helpers";

/** Flujo 112 (C8-18): /settings/textos, los textos para Ani en un lugar. Solo admin. */
test.describe("Flujo 112: textos para Ani (C8-18)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("admin: cada texto con su archivo, lo que hay que decidir y sin violaciones de axe", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Textos para revisar" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Textos para revisar" }),
    ).toBeVisible();
    await expect(page.getByText("Piso salarial mensual en USD (opcional)")).toBeVisible();
    await expect(page.getByText("apps/web/components/profile-form.tsx")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "«¿Qué es esto?» completo (C8-6)" }),
    ).toBeVisible();
    const { violations, unmeasured } = await axeSummary(page);
    expect(violations).toEqual([]);
    expect(unmeasured).toEqual([]);
  });

  test("quien no administra la beta recibe un 404", async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
    const res = await page.goto("/settings/textos");
    expect(res?.status()).toBe(404);
  });
});
