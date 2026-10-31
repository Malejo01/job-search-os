import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { cleanup, createInvitation, newRun, register } from "./personas/flow";

/**
 * Flujo 90 (R2-2): chips de áreas de especialidad en el onboarding.
 * - Al marcar una carrera con especialidades (finanzas_contabilidad), aparecen sus chips.
 * - «Todas las áreas» está marcada por defecto.
 * - Cada chip muestra de 2 a 3 ejemplos de puesto en lenguaje simple.
 * - Las áreas poco publicadas muestran «te avisamos si aparece».
 * - Al desmarcar la carrera, los chips desaparecen.
 * - Accesibilidad axe en modo claro y oscuro sin violaciones.
 */
test.describe("Flujo 90: chips de especialidad en el onboarding (R2-2)", () => {
  test.describe.configure({ mode: "serial" });

  const run = newRun("lucia");
  const password = randomBytes(18).toString("base64url");
  run.persona = { ...run.persona, role: "finanzas_contabilidad", password };

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

  test("al marcar una carrera con especialidades se muestran sus chips con 'Todas las áreas' por defecto", async () => {
    const finanzasCheckbox = page.locator(
      'input[name="targetRoles"][value="finanzas_contabilidad"]',
    );

    // Inicialmente no está marcada y no se ven los chips
    await expect(page.getByTestId("role-specialties-finanzas_contabilidad")).toHaveCount(0);

    // Al marcar finanzas_contabilidad aparecen los chips
    await finanzasCheckbox.check();
    const specialtiesPanel = page.getByTestId("role-specialties-finanzas_contabilidad");
    await expect(specialtiesPanel).toBeVisible();

    // «Todas las áreas» marcado por defecto
    const allChip = page.getByTestId("specialty-all-finanzas_contabilidad");
    await expect(allChip).toBeVisible();
    await expect(allChip).toHaveAttribute("aria-checked", "true");
    await expect(allChip).toContainText("Todas las áreas");

    // Ejemplos visibles en lenguaje simple
    const sueldosChip = page.getByTestId("specialty-chip-finanzas_contabilidad-sueldos");
    await expect(sueldosChip).toBeVisible();
    await expect(sueldosChip).toContainText("Sueldos");
    await expect(sueldosChip).toContainText("liquidador/a de sueldos");
    await expect(sueldosChip).toContainText("payroll");

    // Área poco publicada lleva «te avisamos si aparece»
    const periciasChip = page.getByTestId(
      "specialty-chip-finanzas_contabilidad-concursos_y_pericias_judiciales",
    );
    await expect(periciasChip).toBeVisible();
    await expect(periciasChip).toContainText("te avisamos si aparece");
  });

  test("la interacción de toggle acota o restablece todas las áreas", async () => {
    const allChip = page.getByTestId("specialty-all-finanzas_contabilidad");
    const sueldosChip = page.getByTestId("specialty-chip-finanzas_contabilidad-sueldos");

    // Al tocar «Sueldos», se desmarca «Todas las áreas» y solo queda Sueldos marcada
    await sueldosChip.click();
    await expect(allChip).toHaveAttribute("aria-checked", "false");
    await expect(sueldosChip).toHaveAttribute("aria-checked", "true");

    // Al tocar «Todas las áreas», vuelve al estado por defecto
    await allChip.click();
    await expect(allChip).toHaveAttribute("aria-checked", "true");
  });

  test("accesibilidad axe en modo claro y oscuro", async () => {
    // Modo claro
    const lightAxe = await axeSummary(page);
    expect(lightAxe.violations).toEqual([]);

    // Modo oscuro
    await page.evaluate(() => {
      localStorage.setItem("jso-tema", "oscuro");
      document.documentElement.classList.add("dark");
    });

    const darkAxe = await axeSummary(page);
    expect(darkAxe.violations).toEqual([]);

    // Restablecer
    await page.evaluate(() => {
      localStorage.removeItem("jso-tema");
      document.documentElement.classList.remove("dark");
    });
  });

  test("al desmarcar la carrera los chips de especialidad desaparecen", async () => {
    const finanzasCheckbox = page.locator(
      'input[name="targetRoles"][value="finanzas_contabilidad"]',
    );
    await finanzasCheckbox.uncheck();
    await expect(page.getByTestId("role-specialties-finanzas_contabilidad")).toHaveCount(0);
  });
});
