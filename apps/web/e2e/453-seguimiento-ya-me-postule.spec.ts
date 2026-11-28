import { expect, test } from "@playwright/test";
import {
  applicationOutcomeById,
  createApplicationForSeedUser,
  createJob,
  deleteJob,
  login,
} from "./helpers";

/**
 * Flujo 453 (R34-04): seguimiento mínimo en «Ya me postulé». Cada oferta de la pestaña muestra la fecha de la
 * postulación y un estado que la persona cambia a mano; el cambio queda guardado. Sin recordatorios ni
 * predicciones, sin modelo y sin red.
 */
test.describe("Flujo 453: seguimiento en «Ya me postulé»", () => {
  let jobId: string;
  let applicationId: string;
  const title = `E2E seguimiento ${Date.now()}`;

  test.beforeAll(async () => {
    jobId = await createJob({ title, status: "aplicada", jdText: "JD ficticio de seguimiento." });
    applicationId = await createApplicationForSeedUser(jobId);
  });
  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("muestra la fecha, cambia el estado a mano y queda guardado", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=aplicada");
    const card = page.getByTestId("tarjeta-oferta").filter({ hasText: title });
    await expect(card).toBeVisible();

    // La fecha de la postulación (se creó hoy)
    const today = new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split("-");
    await expect(card.getByTestId("seguimiento-fecha")).toHaveText(
      `Ya me postulé el ${d}/${m}/${y}`,
    );

    // El estado arranca en «Sin respuesta» y se cambia a mano
    const estado = card.getByTestId("seguimiento-estado");
    await expect(estado).toHaveValue("sin_respuesta");
    await estado.selectOption("entrevista");
    await card.getByRole("button", { name: "Guardar estado" }).click();
    await expect.poll(() => applicationOutcomeById(applicationId)).toBe("entrevista");

    await page.reload();
    await expect(
      page
        .getByTestId("tarjeta-oferta")
        .filter({ hasText: title })
        .getByTestId("seguimiento-estado"),
    ).toHaveValue("entrevista");
  });

  test("las demás pestañas no muestran el seguimiento", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    await expect(page.getByTestId("seguimiento-postulacion")).toHaveCount(0);
  });
});
