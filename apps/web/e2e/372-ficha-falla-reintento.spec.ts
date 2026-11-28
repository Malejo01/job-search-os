import { expect, test } from "@playwright/test";
import { avisoFicticio, cardRow, cleanCards, createJobForB, deleteJobsOfB } from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";

/**
 * Flujo 372 (R31-03): el modelo falla. La marca `DEMO_FICHA_FALLA` en el aviso hace que el modelo simulado
 * devuelva algo que no cumple el esquema: la ficha queda «fallida», la pantalla ofrece «Reintentar» y cada
 * reintento suma un intento (con máximo) sin romper el resto de la página. Datos inventados. Requiere
 * `JOB_CARD: "testers"` en el webServer de playwright.config.ts.
 */
test.describe("Flujo 372: ficha fallida y reintento", () => {
  const tag = `372-${Date.now()}`;
  const jdText = avisoFicticio(tag, "DEMO_FICHA_FALLA");
  let jobId = "";
  let hash = "";

  test.beforeAll(async () => {
    const created = await createJobForB({ title: `E2E ficha falla ${tag}`, jdText });
    jobId = created.jobId;
    hash = created.hash!;
    await cleanCards([hash]);
  });
  test.afterAll(async () => {
    await cleanCards([hash]);
    await deleteJobsOfB([jobId]);
  });

  test("error con «Reintentar»; el reintento vuelve a intentar y la página sigue entera", async ({
    page,
  }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    const estado = page.getByTestId("ficha-estado");
    await expect(estado).toHaveAttribute("data-estado", "fallida", { timeout: 30_000 });
    await expect(estado).toContainText("No pudimos preparar el resumen.");
    expect(await cardRow(hash)).toMatchObject({ status: "fallida", attempts: 1, card: null });

    // El resto del detalle sigue a la vista
    await expect(page.getByTestId("condiciones")).toBeVisible();

    await estado.getByRole("button", { name: "Reintentar" }).click();
    await expect.poll(async () => (await cardRow(hash))?.attempts, { timeout: 30_000 }).toBe(2);
    expect(await cardRow(hash)).toMatchObject({ status: "fallida" });
    // Los intentos se cuentan en la ficha: el modelo simulado no deja fila en llm_calls cuando falla antes de responder
  });

  test("sin pedirlo, abrir de nuevo el detalle no vuelve a llamar al modelo", async ({ page }) => {
    const before = (await cardRow(hash))?.attempts;
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("ficha-estado")).toHaveAttribute("data-estado", "fallida");
    await page.waitForTimeout(1500);
    expect((await cardRow(hash))?.attempts).toBe(before);
  });
});
