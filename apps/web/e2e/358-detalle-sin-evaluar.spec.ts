import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 358 (R30-08): detalle de una oferta sin evaluar. Siempre las 7 filas de «Lo importante para
 * decidir» (con «No especificado» cuando el aviso no lo dice), el botón «Evaluar esta oferta» y
 * ningún bloque que invente contenido (los de la R31 no aparecen). Datos inventados.
 */
test.describe("Flujo 358: detalle sin evaluar", () => {
  let jobId = "";
  test.beforeAll(async () => {
    jobId = await createJob({
      title: `E2E detalle sin evaluar ${Date.now()}`,
      status: "prefiltrada",
      jdText: "Descripción ficticia de un aviso para la prueba del detalle sin evaluar.",
    });
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("las 7 filas, «No especificado» y el botón de evaluar", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const bloque = page.getByTestId("condiciones");
    await expect(bloque.getByRole("heading", { name: "Lo importante para decidir" })).toBeVisible();
    for (const key of [
      "modality",
      "location",
      "salary",
      "seniority",
      "language",
      "hours",
      "contract",
    ]) {
      await expect(bloque.getByTestId(`condicion-${key}`)).toBeVisible();
    }
    await expect(bloque.getByText("No especificado").first()).toBeVisible();
    // Remoto o no, «desde dónde podés trabajar» no se deduce
    await expect(
      bloque.getByTestId("condicion-location").getByText("No especificado"),
    ).toBeVisible();

    const antes = page.getByTestId("antes-de-evaluar");
    await expect(antes.getByRole("button", { name: "Evaluar esta oferta" })).toBeVisible();
    // Nunca dos puntajes a la vista: sin evaluación, no hay «Cómo encaja»
    await expect(page.getByTestId("como-encaja")).toHaveCount(0);
  });

  for (const width of [390, 360]) {
    test(`a ${width} px: sin scroll horizontal y axe sin violaciones`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      await expect(page.getByTestId("condiciones")).toBeVisible();
      const { violations } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
});
