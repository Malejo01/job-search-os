import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createJob, deleteJob, E2E_USER_ID, jobStatus, login, ownerDb } from "./helpers";

/**
 * Flujo 86 (AG-5): el asistente propone ACCIONES como tarjetas-formulario y la base no cambia hasta
 * el clic de la persona. Modelo simulado (`LLM_DEMO=1`):
 * - en el detalle de una oferta, «ya me postulé» propone marcarla aplicada: la tarjeta sola no
 *   cambia el estado, «Descartar» tampoco, y «Marcar como aplicada» lo cambia con la Server Action
 *   de siempre (el sistema no postula: solo marca);
 * - «agregá la oferta X de Y» prellena el alta manual: no se crea nada hasta «Agregar la oferta».
 *
 * Solo admins, como el flujo 85: en el CI el botón «Asistente» tiene que estar.
 */

async function openAssistant(page: Page) {
  const button = page.getByRole("button", { name: "Asistente", exact: true });
  if ((await button.count()) === 0) {
    expect(process.env.CI, "En el CI el botón «Asistente» tiene que estar").toBeFalsy();
    test.skip(true, "El asistente no está encendido para el usuario e2e");
  }
  await button.click();
  const panel = page.getByTestId("assistant-panel");
  await expect(panel).toBeVisible();
  return panel;
}

async function ask(page: Page, text: string) {
  const panel = page.getByTestId("assistant-panel");
  await panel.getByLabel("Tu mensaje").fill(text);
  await panel.getByRole("button", { name: "Enviar" }).click();
}

async function jobsTitled(title: string): Promise<string[]> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(and(eq(s.jobs.userId, E2E_USER_ID), eq(s.jobs.title, title)));
    return rows.map((r) => r.id);
  } finally {
    await close();
  }
}

test.describe("Flujo 86: acciones del asistente con confirmación", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("cambio de estado: la tarjeta no escribe; el botón sí", async ({ page }) => {
    const jobId = await createJob({
      title: `Backend asistente ${Date.now()}`,
      status: "evaluada",
      jdText: null,
    });
    try {
      await page.goto(`/jobs/${jobId}`);
      const panel = await openAssistant(page);

      await ask(page, "Ya me postulé a esta oferta ayer");
      let card = panel.getByTestId("assistant-action");
      await expect(card).toBeVisible();
      await expect(card).toContainText("Aplicada");
      await expect(card).toContainText("el sistema nunca postula por vos");
      await expect(card).toContainText("Ya me postulé");
      expect(await jobStatus(jobId)).toBe("evaluada");

      await card.getByRole("button", { name: "Descartar" }).click();
      await expect(card).toContainText("Descartada");
      expect(await jobStatus(jobId)).toBe("evaluada");

      await ask(page, "Perdón, sí: ya me postulé a esta");
      card = panel.getByTestId("assistant-action").last();
      await expect(card.getByRole("button", { name: "Marcar como aplicada" })).toBeVisible();
      expect(await jobStatus(jobId)).toBe("evaluada");

      await card.getByRole("button", { name: "Marcar como aplicada" }).click();
      await expect.poll(() => jobStatus(jobId)).toBe("aplicada");
      await expect(card).toContainText("Listo");
    } finally {
      await deleteJob(jobId);
    }
  });

  test("cargar un aviso: no se crea hasta «Agregar la oferta»", async ({ page }) => {
    const tag = Date.now();
    const title = `Analista de Pruebas ${tag}`;
    const company = "Compañía Inventada E2E";
    try {
      await page.goto("/jobs");
      const panel = await openAssistant(page);

      await ask(
        page,
        `Agregá la oferta ${title} de ${company}: https://empleos.example.com/e2e/${tag}`,
      );
      const card = panel.getByTestId("assistant-action");
      await expect(card).toBeVisible();
      await expect(card.locator('input[name="title"]')).toHaveValue(title);
      await expect(card.locator('input[name="company"]')).toHaveValue(company);
      await expect(card.locator('input[name="url"]')).toHaveValue(
        `https://empleos.example.com/e2e/${tag}`,
      );
      expect(await jobsTitled(title)).toEqual([]);
      // La tarjeta-formulario dentro del panel no suma violaciones graves de accesibilidad
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="assistant-panel"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();
      expect(
        axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
      ).toEqual([]);

      await card.getByRole("button", { name: "Agregar la oferta" }).click();
      await page.waitForURL(/\/jobs\/[0-9a-f-]{36}/);
      await expect.poll(() => jobsTitled(title)).toHaveLength(1);
    } finally {
      for (const id of await jobsTitled(title)) await deleteJob(id);
    }
  });
});
