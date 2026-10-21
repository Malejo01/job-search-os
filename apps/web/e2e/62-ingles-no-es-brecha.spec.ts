import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { createJob, deleteJob, E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 62 (ronda 101): en un aviso en español que no pide inglés, «Lo que te falta» no muestra el
 * inglés como brecha aunque el modelo lo haya guardado. Si el aviso sí lo pide, se muestra.
 * Avisos inventados.
 */
const ES_SIN_INGLES =
  "Buscamos una persona para desarrollar la plataforma de la empresa. Trabajarás con el equipo " +
  "de producto en las tareas del día a día y tendrás que participar en las reuniones del equipo. " +
  "Ofrecemos un buen ambiente para trabajar con las herramientas que necesites.";

async function evaluateWithGaps(jobId: string, gaps: string[]): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.evaluations).values({
      jobId,
      userId: E2E_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score: 7,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps,
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación de prueba (e2e).",
      accion: "guardar",
    });
  } finally {
    await close();
  }
}

test.describe("Flujo 62: el inglés no es brecha si el aviso no lo pide", () => {
  test("aviso en español sin inglés: no aparece; el resto de las brechas sí", async ({ page }) => {
    const jobId = await createJob({
      title: "E2E ingles no es brecha",
      status: "evaluada",
      jdText: ES_SIN_INGLES,
    });
    try {
      await evaluateWithGaps(jobId, ["Inglés avanzado", "Experiencia con Kubernetes"]);
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const block = page.locator("div", {
        has: page.getByRole("heading", { name: "Lo que te falta" }),
      });
      await expect(block.first()).toContainText("Experiencia con Kubernetes");
      await expect(block.first()).not.toContainText("Inglés avanzado");
    } finally {
      await deleteJob(jobId);
    }
  });

  test("aviso en español que pide inglés: la brecha se muestra", async ({ page }) => {
    const jobId = await createJob({
      title: "E2E ingles si es brecha",
      status: "evaluada",
      jdText: `${ES_SIN_INGLES}\nRequisitos: inglés intermedio excluyente.`,
    });
    try {
      await evaluateWithGaps(jobId, ["Inglés avanzado"]);
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      await expect(page.getByText("Inglés avanzado").first()).toBeVisible();
    } finally {
      await deleteJob(jobId);
    }
  });
});
