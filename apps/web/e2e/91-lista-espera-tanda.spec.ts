import { appAdmins, invitations, waitlist } from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { inArray } from "drizzle-orm";
import { E2E_EMAIL, E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 91 (C4-2): el admin filtra la lista de espera, ve el contador por carrera, elige personas,
 * confirma, copia el mensaje (que dice cuándo abre la beta) y exporta el CSV. Depende de que el usuario de
 * e2e esté en ADMIN_EMAILS; si no, se saltea. Dos personas inventadas con un sufijo único por corrida
 * (carrera «comunicacion» y un origen propio para no depender de lo que haya en la base); se limpian al final.
 */
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const e2eIsAdmin = adminEmails.includes(E2E_EMAIL.toLowerCase());

const stamp = Date.now();
const ORIGIN = `charla ficticia ${stamp}`;
const A = { email: `tanda.a.${stamp}@example.com`, name: "Ana Tanda" };
const B = { email: `tanda.b.${stamp}@example.com`, name: "Beto Tanda" };
const EMAILS = [A.email, B.email];

test.describe("Flujo 91: lista de espera en tanda (admin)", () => {
  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      if (e2eIsAdmin) {
        await db.insert(appAdmins).values({ userId: E2E_USER_ID }).onConflictDoNothing();
      }
      await db.insert(waitlist).values([
        { ...A, role: "comunicacion", heardFrom: ORIGIN },
        { ...B, role: "comunicacion", heardFrom: ORIGIN.toUpperCase() },
      ]);
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(waitlist).where(inArray(waitlist.email, EMAILS));
      await db.delete(invitations).where(inArray(invitations.email, EMAILS));
    } finally {
      await close();
    }
  });

  test("filtrar, invitar a los seleccionados y exportar", async ({ page }) => {
    test.skip(!e2eIsAdmin, "ADMIN_EMAILS no incluye al usuario de e2e en este entorno");
    await login(page);
    // El origen se filtra por su clave normalizada (minúsculas)
    await page.goto(
      `/settings/invitations?carrera=comunicacion&origen=${encodeURIComponent(ORIGIN)}&estado=sin_invitar`,
    );
    await expect(page.getByTestId("waitlist-counters")).toBeVisible();
    const rows = page.getByTestId("waitlist-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: A.email })).toBeVisible();

    // Elegir a las dos y confirmar
    await rows.filter({ hasText: A.email }).getByRole("checkbox").check();
    await rows.filter({ hasText: B.email }).getByRole("checkbox").check();
    await expect(page.getByTestId("waitlist-bulk")).toContainText("2 elegidas");
    await page.getByRole("button", { name: "Invitar a los seleccionados" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Vas a crear 2 invitaciones");
    await page.getByRole("button", { name: "Confirmar e invitar" }).click();

    const result = page.getByTestId("waitlist-bulk-result");
    await expect(result).toContainText("2 invitaciones creadas");
    await expect(result).toContainText("jueves 26/11");
    await expect(result).toContainText("/register?code=");
    await expect(result).toContainText("Hola Ana:");

    // Recargar: las dos quedan marcadas como invitadas
    await page.goto(
      `/settings/invitations?carrera=comunicacion&origen=${encodeURIComponent(ORIGIN)}`,
    );
    await expect(page.getByTestId("waitlist-row").first()).toContainText("invitada");

    // CSV con los mismos filtros: solo las cinco columnas
    const res = await page.request.get(
      `/settings/invitations/export?carrera=comunicacion&origen=${encodeURIComponent(ORIGIN)}`,
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const csv = (await res.text()).replace("﻿", "");
    const [header, ...lines] = csv.trim().split("\r\n");
    expect(header).toBe("nombre,email,carrera,origen,fecha");
    expect(lines).toHaveLength(2);
    expect(csv).toContain(A.email);
    expect(csv).not.toMatch(/invit|ip_hash/i);
  });

  test("sin sesión el CSV no se entrega", async ({ request }) => {
    const res = await request.get("/settings/invitations/export", { maxRedirects: 0 });
    expect([401, 307, 308, 302, 303]).toContain(res.status());
  });
});
