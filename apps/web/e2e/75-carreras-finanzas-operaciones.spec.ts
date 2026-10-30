import { randomBytes } from "node:crypto";
import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { ownerDb } from "./helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 75 (C-2b, ADR-023): se abren «Contaduría, impuestos y finanzas» y, sin listar, «Asistencia y
 * operaciones». Se verifica lo que ve la gente:
 * - `/mercado/finanzas_contabilidad` carga con su rótulo y está en el sitemap;
 * - «Pedir acceso» guarda «Contaduría, impuestos y finanzas» (check de `waitlist` ampliado);
 * - el onboarding con finanzas ofrece «Contabilidad y conciliaciones»;
 * - operaciones no se ofrece en el selector del onboarding, pero su página de mercado responde 200.
 * Todo inventado (persona `@personas.test`, emails de ejemplo). Requiere las migraciones 0043 y
 * 0044 aplicadas en la base local (`node .claude/bin/local.mjs migrate`).
 */
const FINANZAS = "finanzas_contabilidad";
const FINANZAS_LABEL = "Contaduría, impuestos y finanzas";
const OPERACIONES = "asistencia_operaciones";

test.describe("Flujo 75: carreras de finanzas y operaciones (públicas)", () => {
  test("/mercado/finanzas_contabilidad carga con su rótulo", async ({ page }) => {
    const res = await page.goto(`/mercado/${FINANZAS}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(FINANZAS_LABEL);
  });

  test("el sitemap lista finanzas y no la carrera sin publicar", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain(`/mercado/${FINANZAS}`);
    expect(body).not.toContain(`/mercado/${OPERACIONES}`);
  });

  test("/mercado/asistencia_operaciones responde 200 aunque no se ofrezca", async ({ page }) => {
    const res = await page.goto(`/mercado/${OPERACIONES}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("Flujo 75: lista de espera con finanzas", () => {
  const email = `persona.finanzas.${Date.now()}@example.com`;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(eq(s.waitlist.email, email));
    } finally {
      await close();
    }
  });

  test("/acceso guarda «Contaduría, impuestos y finanzas» y no ofrece operaciones", async ({
    page,
  }) => {
    await page.goto("/acceso");
    const select = page.getByLabel("Carrera");
    const options = await select.locator("option").allInnerTexts();
    expect(options).toContain(FINANZAS_LABEL);
    expect(options).not.toContain("Asistencia virtual y operaciones");

    await page.getByLabel("Nombre").fill("Persona Finanzas Ficticia");
    await page.getByLabel("Email").fill(email);
    await select.selectOption({ label: FINANZAS_LABEL });
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pedir acceso" })).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ role: s.waitlist.role })
        .from(s.waitlist)
        .where(eq(s.waitlist.email, email));
      expect(row?.role).toBe(FINANZAS);
    } finally {
      await close();
    }
  });
});

test.describe("Flujo 75: onboarding con finanzas", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  // La contraseña se genera: un literal lo marcarían los escaneos de secretos del CI.
  const password = randomBytes(18).toString("base64url");
  run.persona = { ...run.persona, role: FINANZAS, password };
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

  test("el selector trae finanzas y no trae operaciones", async () => {
    const { persona } = run;
    await register(page, run);

    const group = page.getByRole("group", { name: "Finanzas y operaciones", exact: true });
    await expect(group.locator(`input[name="targetRoles"][value="${FINANZAS}"]`)).toHaveCount(1);
    await expect(group).toContainText(FINANZAS_LABEL);
    await expect(page.locator(`input[name="targetRoles"][value="${OPERACIONES}"]`)).toHaveCount(0);

    await group.locator(`input[name="targetRoles"][value="${FINANZAS}"]`).check();
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
      expect(row!.targetRoles).toEqual([FINANZAS]);
      expect(row!.targetRole).toBe(FINANZAS);
    } finally {
      await close();
    }
  });

  test("las skills del paso 2 incluyen «Contabilidad y conciliaciones»", async () => {
    await expect(page.locator(`a[href*="rol=${FINANZAS}"]`)).toHaveAttribute(
      "aria-current",
      "true",
    );
    const row = page.getByTestId("skill-general_accounting");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Contabilidad y conciliaciones");
  });
});
