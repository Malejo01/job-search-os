import { expect, test } from "@playwright/test";
import {
  avisoFicticio,
  cardCalls,
  cardRow,
  cleanCards,
  createJobForB,
  deleteJobsOfB,
} from "./ficha-helpers";
import { OFF_USER, ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";

/**
 * Flujo 373 (R31-03): `JOB_CARD` apagada para quien no está en la etapa. Una persona sin ningún rol (no admin, no
 * tester; la A de CI es admin y con `JOB_CARD=testers` vería la ficha) abre su detalle: se ve igual que al cerrar
 * la R30, sin bloques de la ficha, sin «Preparando…», sin fila de ficha y sin gasto. Datos inventados.
 */
test.describe("Flujo 373: JOB_CARD apagada", () => {
  const jdText = avisoFicticio(`373-${Date.now()}`);
  let jobId = "";
  let hash = "";

  test.beforeAll(async () => {
    await ensureOffUser();
    const offUserId = OFF_USER.id;
    const created = await createJobForB({
      title: `E2E ficha apagada ${Date.now()}`,
      jdText,
      userId: offUserId,
    });
    jobId = created.jobId;
    hash = created.hash!;
    await cleanCards([hash]);
  });
  test.afterAll(async () => {
    await cleanCards([hash]);
    await deleteJobsOfB([jobId]);
    await removeOffUser();
  });

  test("sin ficha, sin estado y sin llamadas", async ({ page }) => {
    await loginAsOffUser(page);
    await page.goto(`/jobs/${jobId}`);
    // La R30 tal cual: las 7 filas siguen y no hay nada de la ficha
    await expect(page.getByTestId("condiciones")).toBeVisible();
    await expect(page.getByTestId("ficha-estado")).toHaveCount(0);
    await expect(page.getByTestId("ficha-resumen")).toHaveCount(0);
    await expect(page.getByText("Preparando el resumen…")).toHaveCount(0);
    // Nada se generó ni se gastó, aunque pase un rato
    await page.waitForTimeout(1500);
    expect(await cardRow(hash)).toBeUndefined();
    expect(await cardCalls(hash)).toEqual([]);
  });
});
