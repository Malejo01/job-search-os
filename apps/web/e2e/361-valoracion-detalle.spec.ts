import { expect, test } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, evaluationFeedbackOf, login } from "./helpers";

/**
 * Flujo 361 (R30-11): «¿Te sirve esta evaluación?». «Sí» solo agradece; «No» abre los cuatro
 * motivos con la línea «no cambia tu puntaje». Datos inventados.
 */
test.describe("Flujo 361: valoración de la evaluación", () => {
  let jobId = "";
  test.beforeAll(async () => {
    jobId = await createJob({ title: `E2E valoración ${Date.now()}`, status: "evaluada" });
    await createEvaluation(jobId, { score: 7 });
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("«Sí» muestra solo «Gracias» y «No» abre los motivos", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const grupo = page.getByRole("group", { name: "¿Te sirve esta evaluación?" });
    await grupo.getByRole("button", { name: "Sí, me sirve", exact: true }).click();
    await expect(page.getByTestId("valoracion-gracias")).toHaveText("Gracias");
    await expect(page.getByRole("button", { name: "Guardar motivo" })).toHaveCount(0);

    await grupo.getByRole("button", { name: "No, no me sirve", exact: true }).click();
    for (const motivo of [
      "Leyeron mal un requisito",
      "El puntaje no me parece justo",
      "Falta algo importante",
      "Otro",
    ]) {
      await expect(page.getByRole("button", { name: motivo, exact: true })).toBeVisible();
    }
    await expect(
      page.getByText("Nos ayuda a mejorar la evaluación; no cambia tu puntaje."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Leyeron mal un requisito", exact: true }).click();
    await page.getByRole("button", { name: "Guardar motivo" }).click();
    await expect
      .poll(async () => (await evaluationFeedbackOf(jobId))?.humanNote)
      .toBe("Leyeron mal un requisito");
    expect((await evaluationFeedbackOf(jobId))?.humanVerdict).toBe("en_desacuerdo");
  });
});
