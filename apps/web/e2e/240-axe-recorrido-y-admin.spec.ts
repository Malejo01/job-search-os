import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { E2E_B_USER_ID, ensureSecondUser, login, removeSecondUser } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujo 240 (R26-07): axe sin violaciones y sin scroll horizontal en `/recorrido`, `/admin`, `/admin/personas` y la
 * ficha de una persona, en claro y en oscuro, a 390 px. Entra la persona de prueba admin (`ensureSeedPerson`, con
 * `ADMIN_EMAILS` en el servidor) y la ficha es la de la persona B (ficticia, solo en la base local). `/recorrido` la
 * hace R26-03: si la ruta todavía no existe en este árbol, ese caso falla a propósito (no se saltea).
 */
test.describe("Flujo 240: axe en /recorrido y en el panel /admin (R26-07)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.beforeAll(async () => {
    await ensureSeedPerson();
    await ensureSecondUser();
  });
  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  const screens: Array<[string, string]> = [
    ["recorrido", "/recorrido"],
    ["panel", "/admin"],
    ["personas", "/admin/personas"],
    ["ficha", `/admin/personas/${E2E_B_USER_ID}`],
  ];

  for (const tema of ["claro", "oscuro"] as const) {
    for (const [name, path] of screens) {
      test(`${name}: sin violaciones de axe ni scroll horizontal (${tema})`, async ({ page }) => {
        await login(page);
        await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
        const res = await page.goto(path);
        expect(res?.status(), path).toBe(200);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `${path} ${tema}`).toEqual([]);
        expect(unmeasured, `${path} ${tema}`).toEqual([]);
        const { sw, w } = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          w: window.innerWidth,
        }));
        expect(sw, `scroll horizontal en ${path} ${tema}`).toBeLessThanOrEqual(w);
      });
    }
  }
});
