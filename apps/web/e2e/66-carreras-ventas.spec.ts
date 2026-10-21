import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { ownerDb } from "./helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 66 (ronda 107, ADR-022): se abren dos carreras no técnicas, Ventas B2B y Atención al cliente,
 * y Recruiter IT pasa a llamarse «RRHH y recruiting» (misma clave). Se verifica lo que ve la gente:
 * - las páginas públicas de mercado cargan y el sitemap las lista;
 * - `/mercado/rrhh_it` muestra el rótulo nuevo;
 * - «Pedir acceso» guarda «Ventas B2B (SDR, AE)» (check de `waitlist` ampliado);
 * - el onboarding con `ventas_b2b` ofrece sus skills, entre ellas «Prospección».
 * Todo inventado (persona `@personas.test`, emails de ejemplo). Requiere las migraciones de la
 * ronda 107 aplicadas en la base local (`node .claude/bin/local.mjs migrate`).
 */
const NEW_ROLES = ["ventas_b2b", "atencion_cliente"];
const LABELS = ["Ventas B2B (SDR, AE)", "Atención al cliente"];

test.describe("Flujo 66: carreras de ventas y atención (públicas)", () => {
  test("las dos páginas de mercado cargan", async ({ page }) => {
    for (const [i, role] of NEW_ROLES.entries()) {
      const res = await page.goto(`/mercado/${role}`);
      expect(res?.status(), role).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(LABELS[i]!);
    }
  });

  test("el sitemap lista las dos carreras", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    for (const role of NEW_ROLES) expect(xml, role).toContain(`/mercado/${role}`);
  });

  test("/mercado/rrhh_it muestra «RRHH y recruiting»", async ({ page }) => {
    const res = await page.goto("/mercado/rrhh_it");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("RRHH y recruiting");
  });
});

test.describe("Flujo 66: lista de espera con una carrera de ventas", () => {
  const email = `persona.ventas.${Date.now()}@example.com`;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(eq(s.waitlist.email, email));
    } finally {
      await close();
    }
  });

  test("/acceso ofrece las dos y guarda «Ventas B2B (SDR, AE)»", async ({ page }) => {
    await page.goto("/acceso");
    const select = page.getByLabel("Carrera");
    const options = await select.locator("option").allInnerTexts();
    for (const label of LABELS) expect(options, label).toContain(label);

    await page.getByLabel("Nombre").fill("Persona Ventas Ficticia");
    await page.getByLabel("Email").fill(email);
    await select.selectOption({ label: "Ventas B2B (SDR, AE)" });
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pedir acceso" })).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ role: s.waitlist.role })
        .from(s.waitlist)
        .where(eq(s.waitlist.email, email));
      expect(row?.role).toBe("ventas_b2b");
    } finally {
      await close();
    }
  });
});

test.describe("Flujo 66: onboarding con Ventas B2B", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  run.persona = { ...run.persona, role: "ventas_b2b" };
  let context: BrowserContext | undefined;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await createInvitation(run);
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await cleanup(run, context);
  });

  test("el selector trae «Ventas y atención» y se elige Ventas B2B", async () => {
    const { persona } = run;
    await register(page, run);

    const group = page.getByRole("group", { name: "Ventas y atención", exact: true });
    for (const role of NEW_ROLES) {
      await expect(group.locator(`input[name="targetRoles"][value="${role}"]`)).toHaveCount(1);
    }
    for (const label of LABELS) await expect(group).toContainText(label);

    await group.locator('input[name="targetRoles"][value="ventas_b2b"]').check();
    await page.getByLabel(/País de residencia/).fill(persona.country);
    await page.getByRole("option", { name: new RegExp(`\\(${persona.country}\\)`) }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption(persona.cefr);
    await page.getByLabel(/Años de experiencia/).fill(persona.years);
    await page.getByLabel(/Resumen de tu perfil/).fill(persona.summary);
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({
          id: s.users.id,
          targetRole: s.profiles.targetRole,
          targetRoles: s.profiles.targetRoles,
        })
        .from(s.users)
        .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
        .where(eq(s.users.email, persona.email));
      run.userId = row!.id;
      expect(row!.targetRoles).toEqual(["ventas_b2b"]);
      expect(row!.targetRole).toBe("ventas_b2b");
    } finally {
      await close();
    }
  });

  test("Mis skills ofrece las de Ventas B2B, entre ellas «Prospección»", async () => {
    await expect(page.locator('a[href*="rol=ventas_b2b"]')).toHaveAttribute("aria-current", "true");
    const row = page.getByTestId("skill-prospecting");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Prospección");
  });
});
