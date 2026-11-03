import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, login, loginAsSecondUser, removeSecondUser } from "./helpers";

/**
 * Flujo 109 (C8-11): /settings/salud, el semáforo de la mañana. Solo para quien administra la beta;
 * conteos agregados de la base (cola, gasto de IA, emails, errores de ingesta, activas y feedback) con
 * su nivel en texto, no solo en color. A 390 px y en claro y oscuro.
 */
test.describe("Flujo 109: salud diaria de la beta (C8-11)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("admin: los seis semáforos con su valor y el general", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Salud de la beta" }).click();
    await expect(page).toHaveURL(/\/settings\/salud$/);
    await expect(page.getByRole("heading", { level: 1, name: "Salud de la beta" })).toBeVisible();
    for (const key of ["cola", "ia", "emails", "ingesta", "activas", "feedback"]) {
      const row = page.getByTestId(`salud-${key}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-level", /^(verde|amarillo|rojo|gris)$/);
      await expect(row.locator("span.rounded-badge")).toHaveText(/^(Bien|Mirar|Actuar|Sin dato)$/);
    }
    // El e2e corre con LLM_DAILY_CAP_USD=0: sin tope, gris y dicho en texto
    await expect(page.getByTestId("salud-ia")).toContainText("sin tope");
    await expect(page.getByTestId("salud-emails")).toContainText("de 100");
    await expect(page.getByTestId("salud-general")).toContainText("En general:");
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`sin violaciones de axe ni scroll horizontal (${tema})`, async ({ page }) => {
      await login(page);
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/settings/salud");
      await expect(page.getByTestId("salud-cola")).toBeVisible();
      const { violations, unmeasured } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(unmeasured).toEqual([]);
      const { sw, w } = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        w: window.innerWidth,
      }));
      expect(sw).toBeLessThanOrEqual(w);
    });
  }

  test("quien no administra la beta recibe un 404", async ({ page }) => {
    await ensureSecondUser();
    await loginAsSecondUser(page);
    const res = await page.goto("/settings/salud");
    expect(res?.status()).toBe(404);
  });
});
