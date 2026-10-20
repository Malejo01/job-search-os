import { appAdmins, invitations, waitlist } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_EMAIL, E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 46 (ronda 70): el admin ve la lista de espera en /settings/invitations, crea la invitación con
 * un clic (el link sale una vez, atado al email) y borra a la persona. Depende de que el usuario de e2e
 * esté en ADMIN_EMAILS; si no, se saltea. Persona inventada con Date.now(); se limpia al final.
 */
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const e2eIsAdmin = adminEmails.includes(E2E_EMAIL.toLowerCase());

test.describe("Flujo 46: lista de espera (admin)", () => {
  const email = `persona.espera.${Date.now()}@example.com`;

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      // La base también exige estar en app_admins (el seed lo hace si ADMIN_EMAILS incluye al usuario)
      if (e2eIsAdmin) {
        await db.insert(appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
      }
      await db.insert(waitlist).values({
        email,
        name: "Persona Espera",
        role: "data_analyst",
        heardFrom: "una charla ficticia",
      });
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(waitlist).where(eq(waitlist.email, email));
      await db.delete(invitations).where(eq(invitations.email, email));
    } finally {
      await close();
    }
  });

  test("verla, invitarla con un clic y borrarla", async ({ page }) => {
    test.skip(!e2eIsAdmin, "ADMIN_EMAILS no incluye al usuario de e2e en este entorno");
    await login(page);
    await page.goto("/settings/invitations");
    await expect(
      page.getByRole("heading", { name: /Lista de espera \(\d+ sin invitar\)/ }),
    ).toBeVisible();

    const row = page.getByTestId("waitlist-row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Persona Espera");
    await expect(row).toContainText("sin invitar");

    await row.getByRole("button", { name: "Crear invitación" }).click();
    await expect(row).toContainText("Copiá el link ahora");
    await expect(row.locator("code")).toContainText("/register?code=");
    await expect(row).toContainText(/invitada/);
    await expect(row.getByRole("button", { name: "Crear invitación" })).toHaveCount(0);

    // Borrado con doble confirmación, sin window.confirm
    await row.getByRole("button", { name: "Borrar", exact: true }).click();
    await expect(row).toContainText("Usalo si la persona pidió que borremos sus datos");
    await row.getByRole("button", { name: "¿Seguro? Borrar" }).click();
    await expect(page.getByTestId("waitlist-row").filter({ hasText: email })).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const left = await db
        .select({ id: waitlist.id })
        .from(waitlist)
        .where(eq(waitlist.email, email));
      expect(left).toHaveLength(0);
    } finally {
      await close();
    }
  });
});
