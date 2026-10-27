import AxeBuilder from "@axe-core/playwright";
import * as s from "@job-search-os/db/schema";
import { expect, test, type Page } from "@playwright/test";
import { and, eq, sql } from "drizzle-orm";
import { createJob, deleteJob, E2E_USER_ID, jobStatus, login, ownerDb } from "./helpers";

/**
 * Flujo 86 (AG-5): el asistente propone ACCIONES como tarjetas-formulario y la base no cambia hasta
 * el clic de la persona. Modelo simulado (`LLM_DEMO=1`):
 * - en el detalle de una oferta, «ya me postulé» propone marcarla aplicada: la tarjeta sola no
 *   cambia el estado, «Descartar» tampoco, y «Marcar como aplicada» lo cambia con el mismo núcleo
 *   que el botón del detalle (el sistema no postula: solo marca). Si la oferta cambió entre la
 *   tarjeta y el clic, no pisa nada y avisa en la tarjeta;
 * - «todavía no me postulé» no propone nada;
 * - «agregá la oferta X de Y» prellena el alta manual: no se crea nada hasta «Agregar la oferta»;
 *   un error (campo demasiado largo) aparece en la tarjeta sin perder la charla ni lo escrito.
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

type StoredJob = { id: string; company: string; url: string | null };

async function jobsTitled(title: string): Promise<StoredJob[]> {
  const { db, close } = ownerDb();
  try {
    return await db
      .select({ id: s.jobs.id, company: s.jobs.companyRaw, url: s.jobs.canonicalUrl })
      .from(s.jobs)
      .where(and(eq(s.jobs.userId, E2E_USER_ID), eq(s.jobs.title, title)));
  } finally {
    await close();
  }
}

/** Cambia el estado por fuera de la tarjeta (como si la persona lo hubiera hecho en otra pestaña). */
async function setStatus(jobId: string, status: "aplicada"): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.update(s.jobs).set({ status }).where(eq(s.jobs.id, jobId));
  } finally {
    await close();
  }
}

async function applicationsOf(jobId: string): Promise<number> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId));
    return row?.n ?? 0;
  } finally {
    await close();
  }
}

const seriousViolations = async (page: Page) => {
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="assistant-panel"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
};

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
      // La tarjeta muestra la oración completa de la persona
      await expect(card).toContainText("«Ya me postulé a esta oferta ayer»");
      expect(await jobStatus(jobId)).toBe("evaluada");
      expect(await seriousViolations(page)).toEqual([]);

      await card.getByRole("button", { name: "Descartar" }).click();
      await expect(card).toContainText("Descartada");
      expect(await jobStatus(jobId)).toBe("evaluada");

      await ask(page, "Perdón, sí: ya me postulé a esta");
      card = panel.getByTestId("assistant-action").last();
      await expect(card.getByRole("button", { name: "Marcar como aplicada" })).toBeVisible();
      expect(await jobStatus(jobId)).toBe("evaluada");

      await card.getByRole("button", { name: "Marcar como aplicada" }).click();
      await expect.poll(() => jobStatus(jobId)).toBe("aplicada");
      await expect(card).toContainText("Listo: la oferta quedó en Aplicada.");
      await expect(card.getByRole("link", { name: "Ver la oferta" })).toHaveAttribute(
        "href",
        `/jobs/${jobId}`,
      );
      // El foco pasa al texto de estado de la tarjeta (el botón ya no está)
      await expect(card.getByText("Listo: la oferta quedó en Aplicada.")).toBeFocused();
    } finally {
      await deleteJob(jobId);
    }
  });

  test("si la oferta cambió desde la tarjeta, no pisa nada y avisa ahí", async ({ page }) => {
    const jobId = await createJob({
      title: `Backend cambiada ${Date.now()}`,
      status: "evaluada",
      jdText: null,
    });
    try {
      await page.goto(`/jobs/${jobId}`);
      const panel = await openAssistant(page);
      await ask(page, "Ya me postulé a esta oferta ayer");
      const card = panel.getByTestId("assistant-action");
      await expect(card).toBeVisible();

      await setStatus(jobId, "aplicada");
      const appsBefore = await applicationsOf(jobId);
      await card.getByRole("button", { name: "Marcar como aplicada" }).click();

      await expect(card.getByRole("alert")).toContainText("La oferta cambió a Aplicada");
      // La charla sigue ahí y el estado no tuvo ningún cambio extra
      await expect(panel).toContainText("Ya me postulé a esta oferta ayer");
      expect(await jobStatus(jobId)).toBe("aplicada");
      expect(await applicationsOf(jobId)).toBe(appsBefore);
    } finally {
      await deleteJob(jobId);
    }
  });

  test("«todavía no me postulé» no propone nada", async ({ page }) => {
    const jobId = await createJob({
      title: `Backend sin postular ${Date.now()}`,
      status: "evaluada",
      jdText: null,
    });
    try {
      await page.goto(`/jobs/${jobId}`);
      const panel = await openAssistant(page);
      await ask(page, "Todavía no me postulé a esta");
      await expect(panel.getByText(/^DEMO:/).last()).toBeVisible();
      await expect(panel.getByTestId("assistant-action")).toHaveCount(0);
      expect(await jobStatus(jobId)).toBe("evaluada");
    } finally {
      await deleteJob(jobId);
    }
  });

  test("cargar un aviso: no se crea hasta «Agregar la oferta»", async ({ page }) => {
    const tag = Date.now();
    const title = `Analista de Pruebas ${tag}`;
    const company = "Compañía Inventada E2E";
    const url = `https://empleos.example.com/e2e/${tag}`;
    try {
      await page.goto("/jobs");
      const panel = await openAssistant(page);

      await ask(page, `Agregá la oferta ${title} de ${company}: ${url}`);
      const card = panel.getByTestId("assistant-action");
      await expect(card).toBeVisible();
      await expect(card.locator('input[name="title"]')).toHaveValue(title);
      await expect(card.locator('input[name="company"]')).toHaveValue(company);
      await expect(card.locator('input[name="url"]')).toHaveValue(url);
      expect(await jobsTitled(title)).toEqual([]);
      expect(await seriousViolations(page)).toEqual([]);

      await card.getByRole("button", { name: "Agregar la oferta" }).click();
      await expect(card).toContainText("Listo: la oferta quedó cargada.");
      // No navega sola: la persona sigue en la charla, con un link a la oferta
      expect(new URL(page.url()).pathname).toBe("/jobs");
      const saved = await jobsTitled(title);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.company).toBe(company);
      expect(saved[0]!.url).toBe(url);
      await expect(card.getByRole("link", { name: "Ver la oferta" })).toHaveAttribute(
        "href",
        `/jobs/${saved[0]!.id}`,
      );
    } finally {
      for (const job of await jobsTitled(title)) await deleteJob(job.id);
    }
  });

  test("un error del alta aparece en la tarjeta sin perder lo escrito", async ({ page }) => {
    const tag = Date.now();
    const title = `Analista Largo ${tag}`;
    try {
      await page.goto("/jobs");
      const panel = await openAssistant(page);
      await ask(page, `Agregá la oferta ${title} de Compañía Inventada E2E`);
      const card = panel.getByTestId("assistant-action");
      await expect(card).toBeVisible();

      // Saltea el maxLength del navegador: el servidor tiene que rechazarlo igual
      const location = card.locator('input[name="location"]');
      await location.evaluate((el) => el.removeAttribute("maxlength"));
      await location.fill("x".repeat(400));
      await card.getByRole("button", { name: "Agregar la oferta" }).click();

      await expect(card.getByRole("alert")).toContainText("demasiado largo");
      await expect(card.locator('input[name="title"]')).toHaveValue(title);
      await expect(location).toHaveValue("x".repeat(400));
      await expect(panel).toContainText(`Agregá la oferta ${title}`);
      expect(await jobsTitled(title)).toEqual([]);
    } finally {
      for (const job of await jobsTitled(title)) await deleteJob(job.id);
    }
  });
});
