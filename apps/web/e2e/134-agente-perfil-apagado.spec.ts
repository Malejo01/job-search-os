import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
// Import relativo directo (no el índice de @job-search-os/db, que arrastra import.meta)
import { deleteUserData } from "../../../packages/db/src/user-tables";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 134 (R10-6, ADR-034): con `CV_PROFILE_AGENT` apagado (el valor por defecto de los e2e) el agente de
 * perfil no existe. Las pantallas del cierre dan 404, el endpoint no toca el modelo y el onboarding queda
 * como siempre: sin la elección «Subí tu CV…». Sin sesión, el endpoint no responde con datos (el middleware
 * redirige a /login o la ruta da 401: orden de ADR-034 §9, sesión primero).
 * El recorrido completo con el flag encendido queda para la rama de integración (docs/beta/agente-perfil-pruebas.md).
 * Todo inventado; la persona nueva se borra al final con deleteUserData.
 */
test.describe.configure({ mode: "serial" });

test.describe("Flujo 134: agente de perfil apagado", () => {
  const tag = Date.now();
  const email = `agente-apagado-${tag}@onboarding.test`;
  const password = "agente-clave-local-134";
  let invitationId: string | null = null;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [user] = await db
        .select({ id: s.users.id })
        .from(s.users)
        .where(eq(s.users.email, email));
      if (user) {
        await db
          .transaction(async (tx) => {
            await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
            await deleteUserData(tx as never, user.id);
          })
          .catch(() => {});
        // La primera ingesta corre en `after()` y puede escribir después del borrado
        await db.delete(s.jobs).where(eq(s.jobs.userId, user.id));
      }
      if (invitationId) await db.delete(s.invitations).where(eq(s.invitations.id, invitationId));
    } finally {
      await close();
    }
  });

  test("con sesión, las pantallas del cierre dan 404 y el endpoint no hace nada", async ({
    page,
  }) => {
    await login(page);
    for (const path of ["/cv/perfil/listo", "/onboarding/cv/listo"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    // El endpoint responde «no encontrado» sin tocar el modelo ni mirar el ticket
    const res = await page.request.post("/api/cv-perfil/cierre", {
      data: { action: "write", ticket: "pa1.aaaaaaaaaaaa.9999999999999.sin-firma", lang: "es" },
    });
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body).toMatchObject({ ok: false, error: "not_found" });
    // «Tu CV» sigue como hoy: sin la tarjeta de entrada del agente
    await page.goto("/cv");
    await expect(page.getByTestId("cv-preview")).toBeVisible();
    await expect(page.getByText("Subí tu CV y armamos tu perfil")).toHaveCount(0);
  });

  test("sin sesión, el endpoint no devuelve datos", async ({ playwright, baseURL }) => {
    const ctx = await playwright.request.newContext({ baseURL });
    const res = await ctx.post("/api/cv-perfil/cierre", {
      data: { action: "confirm", ticket: "x", entries: [] },
      maxRedirects: 0,
    });
    // El middleware redirige a /login (307) y, si llegara a la ruta, daría 401; nunca 200 ni 404
    expect([307, 401]).toContain(res.status());
    await ctx.dispose();
  });

  test("el onboarding de una persona nueva queda como hoy: sin la elección del CV", async ({
    browser,
  }) => {
    const code = randomBytes(32).toString("base64url");
    const codeHash = createHash("sha256").update(code).digest("hex");
    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .insert(s.invitations)
        .values({ codeHash, email, createdByUserId: E2E_USER_ID })
        .returning({ id: s.invitations.id });
      invitationId = row!.id;
    } finally {
      await close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await context.newPage();
      await page.goto(`/register?code=${code}`);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Nombre (opcional)").fill("Persona Agente Apagado");
      await page.getByLabel("Contraseña", { exact: true }).fill(password);
      await page.getByLabel("Repetí la contraseña").fill(password);
      await page.getByLabel(/Leí y acepto/).check();
      await page.getByRole("button", { name: "Crear cuenta" }).click();
      await page.waitForURL("**/onboarding**");

      await expect(page.getByRole("heading", { name: "Completá tu perfil" })).toBeVisible();
      await expect(page.getByLabel(/Resumen de tu perfil/)).toBeVisible();
      await expect(page.getByTestId("pa-onboarding-choice")).toHaveCount(0);
      await expect(page.getByText("Subí tu CV y armamos tu perfil")).toHaveCount(0);
      await expect(page.getByText("Prefiero completarlo a mano")).toHaveCount(0);
      // Las pantallas del agente no existen para esta persona
      const res = await page.goto("/onboarding/cv/listo");
      expect(res?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});
