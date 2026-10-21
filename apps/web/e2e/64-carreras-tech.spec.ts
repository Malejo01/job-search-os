import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { ownerDb } from "./helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 64 (ronda 106, ADR-021): se abren dos carreras de tecnología, Data Engineering y
 * Solutions / Sales Engineering. Se verifica lo que ve la gente:
 * - las páginas públicas de mercado de las dos cargan y el sitemap las lista;
 * - «Pedir acceso» ofrece las dos y guarda la carrera (check de `waitlist` ampliado);
 * - el selector del onboarding las trae en el grupo «Tecnología»; quien elige Data Engineering ve
 *   sus skills y el mercado de su carrera.
 * Todo inventado (persona `@personas.test`, emails de ejemplo). Requiere la migración de la ronda 106
 * aplicada en la base local (`node .claude/bin/local.mjs migrate`): el check de la lista de espera.
 */
const NEW_ROLES = ["data_engineer", "solutions_engineer"];
const LABELS = ["Data Engineering", "Solutions / Sales Engineering"];

test.describe("Flujo 64: carreras de tecnología nuevas (públicas)", () => {
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

  test("engineering manager no es una carrera", async ({ request }) => {
    const res = await request.get("/mercado/engineering_manager");
    expect(res.status()).toBe(404);
  });
});

test.describe("Flujo 64: lista de espera con una carrera nueva", () => {
  const email = `persona.tech.${Date.now()}@example.com`;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(eq(s.waitlist.email, email));
    } finally {
      await close();
    }
  });

  test("/acceso ofrece las dos y guarda «Data Engineering»", async ({ page }) => {
    await page.goto("/acceso");
    const select = page.getByLabel("Carrera");
    const options = await select.locator("option").allInnerTexts();
    for (const label of LABELS) expect(options, label).toContain(label);

    await page.getByLabel("Nombre").fill("Persona Tecnologia Ficticia");
    await page.getByLabel("Email").fill(email);
    await select.selectOption({ label: "Data Engineering" });
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pedir acceso" })).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ role: s.waitlist.role })
        .from(s.waitlist)
        .where(eq(s.waitlist.email, email));
      expect(row?.role).toBe("data_engineer");
    } finally {
      await close();
    }
  });
});

test.describe("Flujo 64: onboarding con una carrera nueva", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  run.persona = { ...run.persona, role: "data_engineer" };
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

  test("el selector de Tecnología trae las dos carreras nuevas y se elige Data Engineering", async () => {
    const { persona } = run;
    await register(page, run);

    const group = page.getByRole("group", { name: "Tecnología", exact: true });
    for (const role of NEW_ROLES) {
      await expect(group.locator(`input[name="targetRoles"][value="${role}"]`)).toHaveCount(1);
    }
    for (const label of LABELS) await expect(group).toContainText(label);

    await group.locator('input[name="targetRoles"][value="data_engineer"]').check();
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
      expect(row!.targetRoles).toEqual(["data_engineer"]);
      expect(row!.targetRole).toBe("data_engineer");
    } finally {
      await close();
    }
  });

  test("Mis skills ofrece las de Data Engineering y /market muestra el mercado de su carrera", async () => {
    await expect(page.locator('a[href*="rol=data_engineer"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.getByTestId("skill-etl")).toBeVisible();

    await page.goto("/market");
    await expect(page.getByRole("region", { name: /^Mercado de Data Engineering/ })).toBeVisible();
  });
});
