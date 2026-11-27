import { expect, test } from "@playwright/test";
import { avisoFicticio, createJobForB, deleteJobsOfB } from "./ficha-helpers";
import { ensureOffUser, loginAsOffUser, OFF_USER } from "./voz-helpers";

/**
 * Flujo 384 (R31-04): para una persona fuera de la etapa (sin rol, aunque el servidor tenga `JOB_CARD=testers`)
 * el detalle se ve como al cerrar la R30: ni «La oferta en pocas palabras», ni «Qué vas a hacer», ni «Qué
 * buscan», ni estado de la ficha, ni citas; «Lo importante para decidir» sigue con sus 7 filas. Datos inventados.
 */
test.describe("Flujo 384: detalle con la ficha apagada para quien no está en la etapa", () => {
  let jobId = "";
  test.beforeAll(async () => {
    // `ensureOffUser()` devuelve el id de una sesión de Interview, no el de la persona: va OFF_USER.id
    await ensureOffUser();
    const offUserId = OFF_USER.id;
    const created = await createJobForB({
      title: `E2E ficha apagada ${Date.now()}`,
      jdText: avisoFicticio(`384-${Date.now()}`),
      userId: offUserId,
    });
    jobId = created.jobId;
  });
  test.afterAll(async () => {
    if (jobId) await deleteJobsOfB([jobId]);
  });

  test("sin bloques de la ficha y con las 7 filas", async ({ page }) => {
    await loginAsOffUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("condiciones")).toBeVisible();
    for (const id of ["ficha-estado", "ficha-resumen", "ficha-tareas", "ficha-requisitos"]) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
    await expect(page.getByTestId("ficha-cita")).toHaveCount(0);
    await expect(
      page.getByTestId("condiciones").locator("[data-testid^='condicion-']"),
    ).toHaveCount(7);
  });
});
