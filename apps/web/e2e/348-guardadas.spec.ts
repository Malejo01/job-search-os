import { expect, test } from "@playwright/test";
import { deleteJob, jobStatus, login } from "./helpers";
import { createEvaluatedJob, savedAtOf } from "./listado-helpers";

/**
 * Flujo 348 (R30-03): «Guardada» es una marca con fecha, no un estado. Guardar deja la oferta en «Por
 * revisar» con su marca y la suma a «Guardadas»; «Quitar de guardadas» la saca de ahí. Datos inventados.
 */
test.describe("Flujo 348: guardar y quitar de guardadas", () => {
  const tag = Date.now();
  const title = `Oferta ficticia guardable ${tag}`;
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createEvaluatedJob({ title, score: 8.4 });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("guardar no cambia el estado y la oferta aparece en la pestaña Guardadas", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const card = page.getByRole("listitem").filter({ hasText: title });
    await expect(card.getByTestId("marca-guardada")).toHaveCount(0);

    await card.getByTestId("guardar-oferta").click();
    await expect.poll(() => savedAtOf(jobId)).not.toBeNull();
    expect(await jobStatus(jobId)).toBe("evaluada");

    // Sigue en «Por revisar», ahora con su marca
    await page.goto("/jobs");
    const marked = page.getByRole("listitem").filter({ hasText: title });
    await expect(marked.getByTestId("marca-guardada")).toHaveText("Guardada");

    await page.getByTestId("pestana-guardadas").click();
    await expect(page).toHaveURL(/guardadas=1/);
    await expect(page.getByTestId("pestana-guardadas")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  });

  test("quitar de guardadas la saca de la pestaña y deja el estado igual", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?guardadas=1");
    const card = page.getByRole("listitem").filter({ hasText: title });
    await card.getByTestId("quitar-guardada").click();
    await expect.poll(() => savedAtOf(jobId)).toBeNull();
    expect(await jobStatus(jobId)).toBe("evaluada");

    await page.goto("/jobs?guardadas=1");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);
    await page.goto("/jobs");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  });

  test("la pestaña Guardadas muestra una oferta guardada aunque ya no esté en Por revisar", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByTestId("guardar-oferta")
      .click();
    await expect.poll(() => savedAtOf(jobId)).not.toBeNull();
    // Descartarla la saca de «Por revisar», pero la marca sigue y «Guardadas» la muestra
    await page.goto("/jobs");
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByTestId("descartar-oferta")
      .click();
    await expect.poll(() => jobStatus(jobId)).toBe("descartada");
    await page.goto("/jobs?guardadas=1");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  });
});
