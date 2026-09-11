import { expect, test } from "@playwright/test";
import { createJob, deleteJob, jobStatus, login } from "./helpers";

test.describe("Flujo 3: cambiar estado → persiste", () => {
  let jobId: string;

  test.beforeAll(async () => {
    jobId = await createJob({
      title: `E2E cambio de estado ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de prueba para el flujo de estado.",
    });
  });
  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("marcar aplicada pasa por transition() y queda en la base", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByText("Evaluada", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Marcar aplicada" }).click();
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    // Desde aplicada ya no se puede volver a marcar aplicada: los botones siguen a la máquina de estados
    await expect(page.getByRole("button", { name: "Marcar aplicada" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Entrevista" })).toBeVisible();

    await page.reload();
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    expect(await jobStatus(jobId)).toBe("aplicada");
  });
});
