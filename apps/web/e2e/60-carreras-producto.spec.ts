import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { ownerDb } from "./helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 60 (ronda 97, ADR-019): `producto_proyectos` se partió en cuatro carreras (Product Manager,
 * Product Owner, Project Manager / Scrum y Product Marketing). Se verifica lo que ve la gente:
 * - la URL pública vieja responde 308 a la nueva y esa carga;
 * - el selector del onboarding trae el grupo «Producto y proyectos» con las 4 opciones, sin la vieja;
 * - quien elige una carrera nueva ve su mercado;
 * - «Pedir acceso» ofrece «Product Owner» y guarda la carrera;
 * - el sitemap tiene las 4 páginas y ninguna con la clave vieja.
 * Todo inventado (persona `@personas.test`, emails de ejemplo). Requiere la migración 0033 aplicada
 * en la base local (`node .claude/bin/local.mjs migrate`): el check de la lista de espera.
 */
const NEW_ROLES = ["product_manager", "product_owner", "project_manager", "product_marketing"];
const LABELS = ["Product Manager", "Product Owner", "Project Manager / Scrum", "Product Marketing"];

test.describe("Flujo 60: carreras de producto (públicas)", () => {
  test("la URL vieja de mercado responde 308 a Product Manager y esa carga", async ({
    page,
    request,
  }) => {
    for (const area of ["mercado", "ofertas"]) {
      const res = await request.get(`/${area}/producto_proyectos`, { maxRedirects: 0 });
      expect(res.status(), area).toBe(308);
      expect(new URL(res.headers().location!, "http://x").pathname).toBe(
        `/${area}/product_manager`,
      );
    }
    await page.goto("/mercado/producto_proyectos");
    await expect(page).toHaveURL(/\/mercado\/product_manager$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("las cuatro páginas de mercado cargan", async ({ page }) => {
    for (const role of NEW_ROLES) {
      const res = await page.goto(`/mercado/${role}`);
      expect(res?.status(), role).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  });

  test("el sitemap tiene las 4 carreras y no la clave vieja", async ({ request }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).not.toContain("producto_proyectos");
    for (const role of NEW_ROLES) expect(xml, role).toContain(`/mercado/${role}`);
  });
});

test.describe("Flujo 60: lista de espera con una carrera nueva", () => {
  const email = `persona.producto.${Date.now()}@example.com`;

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      await db.delete(s.waitlist).where(eq(s.waitlist.email, email));
    } finally {
      await close();
    }
  });

  test("/acceso ofrece «Product Owner» y guarda la carrera", async ({ page }) => {
    await page.goto("/acceso");
    const select = page.getByLabel("Carrera");
    const options = await select.locator("option").allInnerTexts();
    for (const label of LABELS) expect(options, label).toContain(label);
    expect(options).not.toContain("Producto y proyectos");

    await page.getByLabel("Nombre").fill("Persona Producto Ficticia");
    await page.getByLabel("Email").fill(email);
    await select.selectOption({ label: "Product Owner" });
    await page.getByRole("button", { name: "Pedir acceso" }).click();
    await expect(page.getByRole("status").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Pedir acceso" })).toHaveCount(0);

    const { db, close } = ownerDb();
    try {
      const [row] = await db
        .select({ role: s.waitlist.role })
        .from(s.waitlist)
        .where(eq(s.waitlist.email, email));
      expect(row?.role).toBe("product_owner");
    } finally {
      await close();
    }
  });
});

test.describe("Flujo 60: onboarding con una carrera nueva", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  run.persona = { ...run.persona, role: "product_owner" };
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

  test("el selector trae el grupo «Producto y proyectos» con 4 opciones y se elige una", async () => {
    const { persona } = run;
    await register(page, run);

    const group = page.getByRole("group", { name: "Producto y proyectos", exact: true });
    await expect(group.locator('input[name="targetRoles"]')).toHaveCount(4);
    for (const role of NEW_ROLES) {
      await expect(group.locator(`input[name="targetRoles"][value="${role}"]`)).toHaveCount(1);
    }
    await expect(page.locator('input[name="targetRoles"][value="producto_proyectos"]')).toHaveCount(
      0,
    );
    for (const label of LABELS) await expect(group).toContainText(label);

    await group.locator('input[name="targetRoles"][value="product_owner"]').check();
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
      expect(row!.targetRoles).toEqual(["product_owner"]);
      expect(row!.targetRole).toBe("product_owner");
    } finally {
      await close();
    }
  });

  test("Mis skills ofrece las de Product Owner y /market muestra el mercado de su carrera", async () => {
    await expect(page.locator('a[href*="rol=product_owner"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    await expect(page.getByTestId("skill-user_stories")).toBeVisible();

    await page.goto("/market");
    await expect(page.getByRole("region", { name: /^Mercado de Product Owner/ })).toBeVisible();
  });
});
