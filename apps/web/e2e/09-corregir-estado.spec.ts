import { expect, test, type Page } from "@playwright/test";
import { applicationOf, createEvaluation, createJob, deleteJob, jobStatus, login } from "./helpers";

/**
 * Flujo 9 (JS-028): un estado marcado por error se corrige desde el detalle, con confirmación.
 * La postulación acompaña: volver a "Evaluada" borra la registrada por error.
 */
test.describe("Flujo 9: corregir un estado mal marcado", () => {
  let jobId: string;

  test.beforeAll(async () => {
    jobId = await createJob({
      title: `E2E corrección ${Date.now()}`,
      status: "evaluada",
      jdText: "JD de prueba para corregir estados.",
    });
    await createEvaluation(jobId);
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  async function corregirA(page: Page, estado: string, aceptar: boolean) {
    page.once("dialog", async (d) => {
      expect(d.message()).toMatch(/¿Seguro que querés cambiar el estado de .+ a .+\?/);
      await (aceptar ? d.accept() : d.dismiss());
    });
    const seccion = page.getByRole("group", { name: "Corregir estado" });
    await seccion.getByLabel("Estado correcto").selectOption({ label: estado });
    await seccion.getByRole("button", { name: "Corregir" }).click();
  }

  test("rechazo automático marcado por error → vuelve a Aplicada; cancelar no cambia nada; Evaluada borra la postulación", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    // Sin postulación todavía no hay nada que corregir: la evaluada se maneja con sus botones
    await expect(page.getByRole("group", { name: "Corregir estado" })).toHaveCount(0);

    await page.getByRole("button", { name: "Marcar aplicada" }).click();
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rechazo automático" }).click();
    // Estado terminal: ya no hay botones de eventos para salir, solo la corrección
    await expect(page.getByRole("button", { name: "Rechazo automático" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Entrevista" })).toHaveCount(0);
    await expect(page.getByText("Rechazo automático", { exact: true })).toBeVisible();

    // Cancelar la confirmación no cambia nada
    await corregirA(page, "Aplicada", false);
    await expect(page.getByText("Rechazo automático", { exact: true })).toBeVisible();
    expect(await jobStatus(jobId)).toBe("rechazo_automatico");

    // Aceptar: vuelve a aplicada, la postulación sigue y queda sin resultado
    await corregirA(page, "Aplicada", true);
    await expect(page.getByText("Aplicada", { exact: true })).toBeVisible();
    expect(await jobStatus(jobId)).toBe("aplicada");
    expect(await applicationOf(jobId)).toEqual({ outcome: null });
    // Los botones normales vuelven a estar
    await expect(page.getByRole("button", { name: "Entrevista" })).toBeVisible();

    // En realidad no se había postulado: vuelve a evaluada y la postulación se borra
    await corregirA(page, "Evaluada", true);
    await expect(page.getByText("Evaluada", { exact: true })).toBeVisible();
    expect(await jobStatus(jobId)).toBe("evaluada");
    expect(await applicationOf(jobId)).toBeNull();
  });
});
