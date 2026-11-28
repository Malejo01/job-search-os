import { expect, test } from "@playwright/test";
import { cardCalls, createJobForB, deleteJobsOfB } from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";

/**
 * Flujo 371 (R31-03): aviso sin descripción suficiente. No se llama al modelo: la pantalla dice «Pegá la
 * descripción para ver el resumen» con el botón que ya existe para pegarla. Datos inventados. Requiere
 * `JOB_CARD: "testers"` en el webServer de playwright.config.ts.
 */
test.describe("Flujo 371: ficha sin descripción", () => {
  const ids: string[] = [];
  test.afterAll(async () => {
    await deleteJobsOfB(ids);
  });

  for (const [nombre, jdText] of [
    ["sin descripción", null],
    ["con una descripción muy corta", "Se busca gente para trabajar."],
  ] as const) {
    test(`${nombre}: «Pegá la descripción…» y ninguna llamada al modelo`, async ({ page }) => {
      const created = await createJobForB({ title: `E2E ficha ${nombre} ${Date.now()}`, jdText });
      ids.push(created.jobId);
      await loginAsSecondUser(page);
      await page.goto(`/jobs/${created.jobId}`);
      const estado = page.getByTestId("ficha-estado");
      await expect(estado).toHaveAttribute("data-estado", "sin_texto");
      await expect(estado).toContainText("Pegá la descripción para ver el resumen");
      await expect(estado.getByRole("link", { name: "Pegar la descripción" })).toBeVisible();
      // Sin «Preparando…»: no hay nada que esperar
      await expect(page.getByText("Preparando el resumen…")).toHaveCount(0);
      if (created.hash) expect(await cardCalls(created.hash)).toEqual([]);
    });
  }
});
