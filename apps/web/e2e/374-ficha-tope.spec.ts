import { expect, test } from "@playwright/test";
import {
  avisoFicticio,
  cardCalls,
  cardRow,
  clearFakeCardSpend,
  cleanCards,
  createJobForB,
  deleteJobsOfB,
  fakeCardSpend,
} from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";

/**
 * Flujo 374 (R31-03): tope diario alcanzado. Con el gasto de fichas de las últimas 24 h por encima del tope
 * (USD 1 por defecto), el detalle de un aviso sin ficha dice que hoy se llegó al límite, no llama al modelo y
 * el resto de la página sigue. Al volver a liberarse el cupo, la ficha se genera. Datos inventados. Requiere
 * `JOB_CARD: "testers"` en el webServer de playwright.config.ts.
 */
test.describe("Flujo 374: tope diario de fichas", () => {
  const tag = `374-${Date.now()}`;
  const jdText = avisoFicticio(tag);
  let jobId = "";
  let hash = "";

  test.beforeAll(async () => {
    const created = await createJobForB({ title: `E2E ficha tope ${tag}`, jdText });
    jobId = created.jobId;
    hash = created.hash!;
    await cleanCards([hash]);
    await fakeCardSpend(5);
  });
  test.afterAll(async () => {
    await clearFakeCardSpend();
    await cleanCards([hash]);
    await deleteJobsOfB([jobId]);
  });

  test("dice que se llegó al límite, no gasta y el resto de la app sigue", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    const estado = page.getByTestId("ficha-estado");
    await expect(estado).toHaveAttribute("data-estado", "tope");
    await expect(estado).toContainText("Hoy llegamos al límite de resúmenes");
    // El resto del detalle y de la app no se enteran
    await expect(page.getByTestId("condiciones")).toBeVisible();
    await page.goto("/jobs");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await cardRow(hash)).toBeUndefined();
    expect(await cardCalls(hash)).toEqual([]);
  });

  test("al liberarse el cupo, la ficha se genera", async ({ page }) => {
    await clearFakeCardSpend();
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
    expect(await cardRow(hash)).toMatchObject({ status: "lista" });
  });
});
