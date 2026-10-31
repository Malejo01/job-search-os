import * as s from "@job-search-os/db/schema";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { axeSummary } from "./axe-helpers";
import { ownerDb } from "./helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 92 (C3-3): las áreas de especialidad que elige cada persona se guardan.
 * - El onboarding guarda solo las áreas que acotan (`profiles.target_specialties`).
 * - «Tus puestos» en Ajustes las muestra marcadas y se pueden cambiar.
 * - «Todas las áreas» se guarda como null (sin restricción).
 * - Accesibilidad (axe) de «Tus puestos» con áreas, en claro y oscuro.
 * Todo con una persona inventada; ningún filtro lee todavía las áreas.
 */
const ROLE = "finanzas_contabilidad";

async function savedSpecialties(email: string): Promise<unknown> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ targetSpecialties: s.profiles.targetSpecialties })
      .from(s.users)
      .innerJoin(s.profiles, eq(s.profiles.userId, s.users.id))
      .where(eq(s.users.email, email));
    return row?.targetSpecialties ?? null;
  } finally {
    await close();
  }
}

test.describe("Flujo 92: áreas de especialidad guardadas (C3-3)", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  const password = randomBytes(18).toString("base64url");
  run.persona = { ...run.persona, role: ROLE, password };
  const { persona } = run;

  let context: BrowserContext | undefined;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await createInvitation(run);
    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();
    await register(page, run);
  });

  test.afterAll(async () => {
    await cleanup(run, context);
  });

  test("el onboarding guarda las áreas elegidas, en el orden del catálogo", async () => {
    await page.locator(`input[name="targetRoles"][value="${ROLE}"]`).check();
    await page.getByTestId(`specialty-chip-${ROLE}-sueldos`).click();
    await page.getByTestId(`specialty-chip-${ROLE}-impuestos`).click();
    await expect(page.getByTestId(`specialty-all-${ROLE}`)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await page.getByLabel(/País de residencia/).fill(persona.country);
    await page.getByRole("option", { name: new RegExp(`\\(${persona.country}\\)`) }).click();
    await page.getByLabel(/Tu nivel de inglés/).selectOption(persona.cefr);
    await page.getByLabel(/Años de experiencia/).fill(persona.years);
    await page.getByLabel(/Resumen de tu perfil/).fill(persona.summary);
    await page.getByRole("checkbox", { name: "Remoto" }).check();
    await page.getByRole("button", { name: "Guardar y continuar" }).click();
    await page.waitForURL("**/onboarding/skills**");
    // Impuestos va antes que Sueldos en el catálogo; el orden de los clics no importa
    expect(await savedSpecialties(persona.email)).toEqual({ [ROLE]: ["impuestos", "sueldos"] });
  });

  test("«Tus puestos» las muestra marcadas y pasan axe en claro y oscuro", async () => {
    await page.goto("/settings#puesto");
    await expect(page.getByTestId(`specialty-all-${ROLE}`)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await expect(page.getByTestId(`specialty-chip-${ROLE}-sueldos`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId(`specialty-chip-${ROLE}-impuestos`)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(
      page.getByTestId(`specialty-chip-${ROLE}-contabilidad_y_balances`),
    ).toHaveAttribute("aria-checked", "false");
    expect((await axeSummary(page)).violations).toEqual([]);
    await page.evaluate(() => {
      localStorage.setItem("jso-tema", "oscuro");
      document.documentElement.classList.add("dark");
    });
    expect((await axeSummary(page)).violations).toEqual([]);
    await page.evaluate(() => {
      localStorage.removeItem("jso-tema");
      document.documentElement.classList.remove("dark");
    });
  });

  test("desde Ajustes se cambian las áreas y se guardan sin tocar los puestos", async () => {
    await page.goto("/settings#puesto");
    await page.getByTestId(`specialty-chip-${ROLE}-impuestos`).click(); // la saca: queda Sueldos
    await page.getByRole("button", { name: "Guardar puestos" }).click();
    await page.waitForURL("**/settings?puesto=guardado**");
    expect(await savedSpecialties(persona.email)).toEqual({ [ROLE]: ["sueldos"] });
    await expect(page.getByTestId("current-roles")).toContainText("Contaduría");
  });

  test("«Todas las áreas» se guarda como null", async () => {
    await page.goto("/settings#puesto");
    await page.getByTestId(`specialty-all-${ROLE}`).click();
    await page.getByRole("button", { name: "Guardar puestos" }).click();
    await page.waitForURL("**/settings?puesto=guardado**");
    expect(await savedSpecialties(persona.email)).toBeNull();
    await page.goto("/settings#puesto");
    await expect(page.getByTestId(`specialty-all-${ROLE}`)).toHaveAttribute("aria-checked", "true");
  });
});
