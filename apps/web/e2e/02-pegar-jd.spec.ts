import { expect, test } from "@playwright/test";
import { createJob, deleteJob, login, runDemoWorker } from "./helpers";

const JD = `Buscamos AI Engineer para construir agentes con RAG sobre documentos legales. Responsabilidades: diseñar pipelines de ingesta y embeddings, integrar LLMs vía API (OpenAI, Gemini), evaluar calidad con datasets propios, exponer servicios en Python (FastAPI) y TypeScript. Requisitos: 3+ años en backend, experiencia con vector DBs, prompt engineering y observabilidad de LLM. Deseable: AWS. Remoto para Argentina, contrato full time, salario en USD.`;

test.describe("Flujo 2: pegar JD → evaluación aparece", () => {
  let jobId: string;
  const title = `E2E pendiente de JD ${Date.now()}`;

  test.beforeAll(async () => {
    jobId = await createJob({ title, status: "pendiente_jd" });
  });
  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("la oferta sale de la cola, se encola y el worker demo la evalúa con badge DEMO", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs/pending-jd");
    const card = page.locator("li", { hasText: title });
    await expect(card).toBeVisible();
    await card.getByPlaceholder("Pegá acá la descripción completa del puesto").fill(JD);
    await card.getByRole("button", { name: "Guardar JD y evaluar" }).click();
    await expect(page.getByRole("status")).toContainText("JD guardada y evaluación encolada");
    await expect(page.locator("li", { hasText: title })).toHaveCount(0);

    // El worker (modo demo, sin LLM) toma el mensaje de la cola real
    const out = runDemoWorker();
    expect(out).toContain("MODO DEMO");

    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByText("DEMO · evaluación falsa")).toBeVisible();
    await expect(page.getByText("Evaluada", { exact: true })).toBeVisible();
    await expect(page.getByText(/^DEMO: evaluación falsa/)).toBeVisible();
  });
});
