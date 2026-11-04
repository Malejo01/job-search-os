import { expect, test } from "@playwright/test";
import { createJob, deleteJob, enqueueEvaluation, login, runDemoWorker } from "./helpers";

/**
 * Flujo 8 (JS-027): mientras una oferta se evalúa, se ve en /jobs como "evaluando" (arriba y
 * aunque haya filtro de score) y la vista se actualiza sola cuando termina, sin recargar.
 */
test.describe("Flujo 8: oferta evaluándose visible y actualización sin recargar", () => {
  let jobId: string;
  const title = `E2E en curso ${Date.now()}`;

  test.beforeAll(async () => {
    jobId = await createJob({
      title,
      status: "prefiltrada",
      jdText:
        "Buscamos AI Engineer para agentes con RAG y MCP. Python y TypeScript. Remoto para Argentina, contrato full time en USD.",
    });
    await enqueueEvaluation(jobId);
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("se ve como evaluando aunque haya filtro de score, y se actualiza sola al terminar", async ({
    page,
  }) => {
    await login(page);

    // Con un filtro de score que ninguna oferta sin evaluar pasaría
    await page.goto("/jobs?score=9");
    const filtrada = page.getByRole("listitem").filter({ hasText: title });
    await expect(filtrada).toBeVisible();
    // C10-7: la tarjeta lo dice en texto y con el sello «Leyendo…» que gira
    await expect(filtrada.getByText("Leyendo la oferta contra tu perfil…")).toBeVisible();
    // Arriba de todo, antes que las ya evaluadas
    await expect(page.getByRole("main").getByRole("listitem").first()).toContainText(title);

    // El detalle también lo dice
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByRole("status")).toContainText("En cola para evaluar");

    // La lista abierta se actualiza sola cuando la evaluación termina (acá la termina el worker)
    await page.goto("/jobs?estado=todas");
    const card = page.getByRole("listitem").filter({ hasText: title });
    await expect(card.getByText("Leyendo la oferta contra tu perfil…")).toBeVisible();
    runDemoWorker();
    // El refresco se espacia hasta 10 s después de las primeras vueltas (C-7a): margen de sobra
    await expect(card.getByRole("img", { name: /^puntaje / })).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Leyendo la oferta contra tu perfil…")).toHaveCount(0);
  });
});
