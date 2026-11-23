import { expect, test } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { axeSummary } from "./axe-helpers";
import {
  E2E_USER_ID,
  ensureSecondUser,
  login,
  loginAsSecondUser,
  ownerDb,
  removeSecondUser,
} from "./helpers";

/**
 * Flujo 161 (R22-05): `/settings/apertura`, el checklist de apertura. Solo admins. Cada ítem sale como
 * listo o pendiente, con qué hacer cuando falta algo, y nunca muestra el valor de una variable. Quien no
 * administra recibe un 404. Con el usuario del seed (admin en el e2e, como el flujo 109).
 */
const IDS = [
  "fecha",
  "variables",
  "textos",
  "academy",
  "mascota",
  "routing",
  "mercadopago",
  "invitaciones",
] as const;

test.describe("Flujo 161: checklist de apertura (R22-05)", () => {
  test.skip(!process.env.ADMIN_EMAILS, "sin ADMIN_EMAILS la cuenta del e2e no es admin");

  test.beforeAll(async () => {
    // Como /settings/salud: la pantalla lee la base y exige app_admins además de ADMIN_EMAILS
    const { db, close } = ownerDb();
    try {
      await db.insert(s.appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await removeSecondUser().catch(() => {});
  });

  test("admin: los ocho ítems, cada uno listo o pendiente, con qué hacer si falta algo", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings");
    await page.getByRole("link", { name: "Checklist de apertura" }).click();
    await expect(page).toHaveURL(/\/settings\/apertura$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Checklist de apertura" }),
    ).toBeVisible();
    await expect(page.getByTestId("apertura-resumen")).toContainText(/listos|Todo listo/);
    for (const id of IDS) {
      const row = page.getByTestId(`apertura-${id}`);
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute("data-estado", /^(listo|pendiente)$/);
      if ((await row.getAttribute("data-estado")) === "pendiente") {
        await expect(row).toContainText("Qué hacer:");
      }
    }
    // La mascota todavía no tiene imágenes en el repo: tiene que figurar como pendiente
    await expect(page.getByTestId("apertura-mascota")).toHaveAttribute("data-estado", "pendiente");
    // Solo presencia: nunca el valor de una variable ni un link de pago
    await expect(page.locator("main")).not.toContainText(/mpago\.la|re_[A-Za-z0-9]{8}|@example\./);
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`sin violaciones de axe ni scroll horizontal (${tema})`, async ({ page }) => {
      await login(page);
      await page.evaluate((t) => localStorage.setItem("jso-tema", t), tema);
      await page.goto("/settings/apertura");
      await expect(page.getByTestId("apertura-fecha")).toBeVisible();
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
    const res = await page.goto("/settings/apertura");
    expect(res?.status()).toBe(404);
  });
});
