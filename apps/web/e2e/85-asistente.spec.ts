import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 85 (AG-3): el asistente propone y la base NO cambia sin la confirmación de la persona.
 * Corre con el modelo simulado (`LLM_DEMO=1`, fake guionado de AG-1): «me mudé a <país>» propone
 * el país con la cita exacta. Verifica contra la base, no solo en la pantalla, que:
 * - ver la tarjeta no cambia nada;
 * - «Descartar» no cambia nada;
 * - «Cargar en el formulario» carga los valores en el formulario pero no guarda (recargar sin
 *   tocar Guardar deja lo de antes).
 * Además: un CV pegado no llega al modelo (aviso, sin tarjeta), Escape cierra y el foco vuelve al
 * botón, axe sin violaciones graves con el panel abierto y 360 px sin scroll horizontal.
 *
 * Solo admins: en el CI `ADMIN_EMAILS` incluye al usuario e2e y playwright.config.ts enciende
 * `ASSISTANT_ENABLED=admin`. Si en otro entorno no es admin, no hay botón y el flujo se saltea.
 */

async function storedProfile(): Promise<{ country: string; years: number | null }> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ country: s.profiles.locationCountry, years: s.profiles.yearsTotal })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID))
      .limit(1);
    if (!row) throw new Error("el usuario e2e no tiene perfil");
    return { country: row.country, years: row.years === null ? null : Number(row.years) };
  } finally {
    await close();
  }
}

/** Un país distinto del guardado, con su nombre como lo reconoce el guion demo. */
const otherCountry = (current: string) =>
  current === "UY" ? { code: "CL", name: "Chile" } : { code: "UY", name: "Uruguay" };

async function openAssistant(page: Page) {
  const button = page.getByRole("button", { name: "Asistente", exact: true });
  test.skip(
    (await button.count()) === 0,
    "El asistente no está encendido para el usuario e2e (ASSISTANT_ENABLED o ADMIN_EMAILS)",
  );
  await button.click();
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  return { button, panel };
}

async function ask(page: Page, text: string) {
  const panel = page.getByTestId("assistant-panel");
  await panel.getByLabel("Tu mensaje").fill(text);
  await panel.getByRole("button", { name: "Enviar" }).click();
}

test.describe("Flujo 85: asistente que propone sin escribir", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("ver la propuesta y descartarla no cambia la base", async ({ page }) => {
    const before = await storedProfile();
    const target = otherCountry(before.country);
    await page.goto("/settings/perfil");
    const { panel } = await openAssistant(page);

    await ask(page, `Me mudé a ${target.name} el mes pasado`);
    const card = panel.getByTestId("assistant-proposal");
    await expect(card).toBeVisible();
    await expect(card).toContainText("País");
    await expect(card).toContainText(target.code);
    await expect(card).toContainText(`Me mudé a ${target.name}`);
    expect(await storedProfile()).toEqual(before);

    await card.getByRole("button", { name: "Descartar" }).click();
    await expect(card).toContainText("Descartada");
    expect(await storedProfile()).toEqual(before);

    await page.reload();
    await expect(page.locator('input[name="country"]')).toHaveValue(before.country);
    expect(await storedProfile()).toEqual(before);
  });

  test("«Cargar en el formulario» carga pero no guarda", async ({ page }) => {
    const before = await storedProfile();
    const target = otherCountry(before.country);
    await page.goto("/hoy");
    const { panel } = await openAssistant(page);

    await ask(page, `Me mudé a ${target.name}`);
    const card = panel.getByTestId("assistant-proposal");
    await card.getByRole("button", { name: "Cargar en el formulario" }).click();

    await page.waitForURL("**/settings/perfil");
    await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
    await expect(page.locator('input[name="country"]')).toHaveValue(target.code);
    expect(await storedProfile()).toEqual(before);

    // Sin tocar Guardar: recargar deja lo guardado
    await page.reload();
    await expect(page.locator('input[name="country"]')).toHaveValue(before.country);
    await expect(page.getByTestId("assistant-proposal-loaded")).toHaveCount(0);
    expect(await storedProfile()).toEqual(before);
  });

  test("un CV pegado no va al modelo: aviso y sin tarjeta", async ({ page }) => {
    await page.goto("/hoy");
    const { panel } = await openAssistant(page);
    const cv = [
      "Persona Inventada",
      "persona.inventada@example.com · +1 555 0100",
      "",
      "Experiencia laboral",
      "Desarrolladora en Empresa Ficticia, 2019 - 2023",
      "",
      "Educación",
      "Tecnicatura en Programación, Instituto Imaginario",
      "",
      "Idiomas",
      "Inglés B2",
    ].join("\n");
    await ask(page, cv);
    await expect(panel.getByTestId("assistant-notice")).toContainText("pegaste un CV");
    await expect(panel.getByTestId("assistant-proposal")).toHaveCount(0);
  });

  test("el cargador llena criterios, puestos y skills sin guardar", async ({ page }) => {
    const stash = (destination: string, formValues: Record<string, string | string[]>) =>
      page.evaluate(
        ([d, v]) =>
          sessionStorage.setItem(
            "asistente:propuesta",
            JSON.stringify({ destination: d, formValues: v, diffs: [], savedAt: Date.now() }),
          ),
        [destination, formValues] as const,
      );
    const formValue = (selector: string, name: string) =>
      page
        .locator(selector)
        .evaluate((form, n) => new FormData(form as HTMLFormElement).getAll(n), name);

    await page.goto("/hoy");
    await stash("criteria", { max_weekly_hours: "35" });
    await page.goto("/settings/criteria");
    await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
    await expect(page.locator('input[name="max_weekly_hours"]')).toHaveValue("35");

    await stash("target_roles", { targetRoles: ["backend", "frontend"] });
    await page.goto("/settings");
    await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
    expect((await formValue("#puesto form", "targetRoles")).sort()).toEqual([
      "backend",
      "frontend",
    ]);

    await stash("skill_levels", { "level:python": "2" });
    await page.goto("/settings/skills");
    await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
    expect(
      await formValue('form:has([data-testid="assistant-proposal-loaded"])', "level:python"),
    ).toEqual(["2"]);

    // Nada de eso se guardó: recargar vuelve a lo de siempre
    await page.goto("/settings/criteria");
    await expect(page.getByTestId("assistant-proposal-loaded")).toHaveCount(0);
    await expect(page.locator('input[name="max_weekly_hours"]')).not.toHaveValue("35");
  });

  test("Escape cierra y el foco vuelve al botón; accesible y sin scroll a 360 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto("/hoy");
    const { button, panel } = await openAssistant(page);
    await expect(panel.getByLabel("Tu mensaje")).toBeFocused();

    const { violations } = await new AxeBuilder({ page })
      .include('[data-testid="assistant-panel"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const graves = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(graves.map((v) => v.id)).toEqual([]);

    const { scrollWidth, ancho } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      ancho: window.innerWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(ancho);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(button).toBeFocused();
  });
});
