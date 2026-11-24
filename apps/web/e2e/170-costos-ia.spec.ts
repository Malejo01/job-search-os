import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { ensureSecondUser, login, loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureSeedPerson } from "./persona-qa";

/**
 * Flujo 170 (R21-01): /admin/costos, el gasto de IA de los últimos 30 días por día, tarea y modelo,
 * con fallas, respaldos y la proyección del mes contra el tope. Solo para admins; solo totales. Sin
 * ADMIN_EMAILS la cuenta del e2e no es admin: se saltea limpio y queda para el CI.
 */
test.describe("Flujo 170: costos de IA (R21-01)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.beforeAll(async () => {
    // La función de la base exige app_admins, además de ADMIN_EMAILS (como 109); la persona de prueba la
    // crea el helper si la base local no trae al usuario del seed (R26-07)
    await ensureSeedPerson();
  });

  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("admin: proyección, gasto por día, por tarea y por modelo, sin datos de personas", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Costos de IA" }).click();
    await expect(page).toHaveURL(/\/admin\/costos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Costos de IA" })).toBeVisible();
    await expect(page.getByTestId("costos-proyeccion")).toHaveAttribute(
      "data-level",
      /^(verde|amarillo|rojo|gris)$/,
    );
    for (const id of [
      "costos-resumen",
      "costos-por-dia",
      "costos-por-tarea",
      "costos-por-modelo",
      "costos-fallidas",
      "costos-respaldo",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // 30 días de serie, uno por fila, con ceros donde no hubo llamadas
    await expect(page.getByTestId("costos-por-dia").locator("tbody tr")).toHaveCount(30);
    // Solo totales: ni emails ni ids de personas
    for (const id of ["costos-por-dia", "costos-por-tarea", "costos-por-modelo"]) {
      await expect(page.getByTestId(id)).not.toContainText("@");
    }
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`sin violaciones de axe ni scroll horizontal (${tema})`, async ({ page }) => {
      await login(page);
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/admin/costos");
      await expect(page.getByTestId("costos-resumen")).toBeVisible();
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
    const res = await page.goto("/admin/costos");
    expect(res?.status()).toBe(404);
  });
});
