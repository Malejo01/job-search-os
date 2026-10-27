import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  E2E_USER_ID,
  login,
  ownerDb,
  seedTargetRoles,
  setSeedTargetRoles,
  skillLevelsOf,
} from "./helpers";

/**
 * Flujo 85 (AG-3): el asistente propone y la base NO cambia sin la confirmación de la persona.
 * Corre con el modelo simulado (`LLM_DEMO=1`, fake guionado de AG-1): «me mudé a <país>» propone
 * el país con la cita exacta. Verifica contra la base, no solo en la pantalla, que:
 * - ver la tarjeta no cambia nada;
 * - «Descartar» no cambia nada;
 * - «Cargar en el formulario» carga SOLO el campo propuesto y no guarda (recargar sin tocar
 *   Guardar deja lo de antes);
 * - en criterios, puestos (en el tope del plan) y skills el cargador llena el formulario y la base
 *   no cambia hasta Guardar.
 * Además: un CV pegado no llega al modelo (aviso, sin tarjeta y sin filas nuevas en llm_calls),
 * Escape cierra y el foco vuelve al botón, axe sin violaciones graves con el panel abierto y
 * 360 px sin scroll horizontal.
 *
 * Solo admins: en el CI `ADMIN_EMAILS` incluye al usuario e2e y playwright.config.ts enciende
 * `ASSISTANT_ENABLED=admin`, así que ahí el botón TIENE que estar. Fuera del CI, si el usuario no
 * es admin, el flujo se saltea.
 */

type StoredProfile = { country: string; years: number | null; summary: string | null };

async function storedProfile(): Promise<StoredProfile> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({
        country: s.profiles.locationCountry,
        years: s.profiles.yearsTotal,
        summary: s.profiles.profileSummary,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID))
      .limit(1);
    if (!row) throw new Error("el usuario e2e no tiene perfil");
    return {
      country: row.country,
      years: row.years === null ? null : Number(row.years),
      summary: row.summary,
    };
  } finally {
    await close();
  }
}

/** Criterios activos (versión y reglas enteras) del usuario e2e. */
async function storedCriteria(): Promise<{ version: number; rules: string } | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ version: s.evaluationCriteria.version, rules: s.evaluationCriteria.rules })
      .from(s.evaluationCriteria)
      .where(
        and(eq(s.evaluationCriteria.userId, E2E_USER_ID), eq(s.evaluationCriteria.active, true)),
      )
      .orderBy(desc(s.evaluationCriteria.version))
      .limit(1);
    return row ? { version: row.version, rules: JSON.stringify(row.rules) } : null;
  } finally {
    await close();
  }
}

async function assistantCallCount(): Promise<number> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.llmCalls)
      .where(and(eq(s.llmCalls.userId, E2E_USER_ID), eq(s.llmCalls.task, "assistant_chat")));
    return row?.n ?? 0;
  } finally {
    await close();
  }
}

/** Un país distinto del guardado, con su nombre como lo reconoce el guion demo. */
const otherCountry = (current: string) =>
  current === "UY" ? { code: "CL", name: "Chile" } : { code: "UY", name: "Uruguay" };

async function openAssistant(page: Page) {
  const button = page.getByRole("button", { name: "Asistente", exact: true });
  if ((await button.count()) === 0) {
    // En el CI el usuario e2e es admin y el flag está encendido: si falta el botón, es un error
    expect(process.env.CI, "En el CI el botón «Asistente» tiene que estar").toBeFalsy();
    test.skip(
      true,
      "El asistente no está encendido para el usuario e2e (ASSISTANT_ENABLED o ADMIN_EMAILS)",
    );
  }
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

/**
 * Deja una propuesta como lo hace «Cargar en el formulario» y avisa por evento, con la persona ya
 * en la pantalla (el mismo camino que usa el panel cuando no hace falta navegar).
 */
async function loadOnScreen(
  page: Page,
  proposal: {
    destination: string;
    formValues: Record<string, string | string[]>;
    criteriaVersion?: number;
  },
) {
  await page.evaluate((p) => {
    sessionStorage.setItem(
      "asistente:propuesta",
      JSON.stringify({
        destination: p.destination,
        formValues: p.formValues,
        diffs: Object.keys(p.formValues).map((field) => ({ field, label: field, after: "x" })),
        criteriaVersion: p.criteriaVersion ?? null,
        receivedAt: Date.now(),
      }),
    );
    window.dispatchEvent(new Event("asistente:propuesta"));
  }, proposal);
}

const formValue = (page: Page, selector: string, name: string) =>
  page
    .locator(selector)
    .evaluate((form, n) => new FormData(form as HTMLFormElement).getAll(n), name);

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

  test("«Cargar en el formulario» carga solo lo propuesto y no guarda", async ({ page }) => {
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
    // Los otros campos siguen como estaban guardados
    await expect(page.locator('textarea[name="summary"]')).toHaveValue(before.summary ?? "");
    await expect(page.locator('input[name="yearsTotal"]')).toHaveValue(
      before.years === null ? "" : String(before.years),
    );
    expect(await storedProfile()).toEqual(before);

    // Sin tocar Guardar: recargar deja lo guardado
    await page.reload();
    await expect(page.locator('input[name="country"]')).toHaveValue(before.country);
    await expect(page.getByTestId("assistant-proposal-loaded")).toHaveCount(0);
    expect(await storedProfile()).toEqual(before);
  });

  test("un CV pegado no va al modelo: aviso, sin tarjeta y sin llamadas", async ({ page }) => {
    await page.goto("/hoy");
    const { panel } = await openAssistant(page);
    const calls = await assistantCallCount();
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
    expect(await assistantCallCount()).toBe(calls);
  });

  test("criterios, puestos en el tope y skills: se cargan y la base no cambia", async ({
    page,
  }) => {
    const rolesBefore = await seedTargetRoles();
    // En el tope del plan gratis (2): la propuesta cambia los dos
    await setSeedTargetRoles({ targetRoles: ["frontend", "backend"], targetRole: "frontend" });
    try {
      const criteria = await storedCriteria();
      const skills = await skillLevelsOf(E2E_USER_ID);
      expect(criteria).not.toBeNull();

      // Criterios: un valor que seguro difiere del guardado
      await page.goto("/settings/criteria");
      const hours = await page.locator('input[name="max_weekly_hours"]').inputValue();
      const wanted = hours === "33" ? "34" : "33";
      await loadOnScreen(page, {
        destination: "criteria",
        formValues: { max_weekly_hours: wanted },
        criteriaVersion: criteria!.version,
      });
      await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
      await expect(page.locator('input[name="max_weekly_hours"]')).toHaveValue(wanted);

      // Con otra versión de criterios no se carga
      await page.reload();
      await loadOnScreen(page, {
        destination: "criteria",
        formValues: { max_weekly_hours: wanted },
        criteriaVersion: criteria!.version + 100,
      });
      await expect(page.getByText("Los criterios cambiaron")).toBeVisible();
      await expect(page.locator('input[name="max_weekly_hours"]')).toHaveValue(hours);

      // Puestos en el tope: se reemplazan los dos
      await page.goto("/settings");
      await loadOnScreen(page, {
        destination: "target_roles",
        formValues: { targetRoles: ["fullstack", "qa"] },
      });
      await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
      expect((await formValue(page, "#puesto form", "targetRoles")).sort()).toEqual([
        "fullstack",
        "qa",
      ]);

      // Skills: la fila (visible u oculta) lleva el nivel propuesto
      await page.goto("/settings/skills");
      const level = skills.python === 2 ? "3" : "2";
      await loadOnScreen(page, {
        destination: "skill_levels",
        formValues: { "level:python": level },
      });
      await expect(page.getByTestId("assistant-proposal-loaded")).toBeVisible();
      expect(
        await formValue(
          page,
          'form:has([data-testid="assistant-proposal-loaded"])',
          "level:python",
        ),
      ).toContain(level);

      // Nada de eso se guardó
      expect(await storedCriteria()).toEqual(criteria);
      expect(await seedTargetRoles()).toEqual({
        targetRoles: ["frontend", "backend"],
        targetRole: "frontend",
      });
      expect(await skillLevelsOf(E2E_USER_ID)).toEqual(skills);
    } finally {
      await setSeedTargetRoles(rolesBefore);
    }
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
