import { expect, test } from "@playwright/test";
import { deleteJob, jobStatus, login } from "./helpers";
import { createEvaluatedJob } from "./listado-helpers";

/**
 * Flujo 351 (R30-06): descartar desde la tarjeta muestra «Oferta descartada. [Deshacer]»; la oferta
 * aparece en «Descartadas» y en «Todas» con «Descartada por vos», «Volver a revisar» y «Ver oferta», sin
 * nada tachado. Datos inventados.
 */
test.describe("Flujo 351: descartar y deshacer", () => {
  const tag = Date.now();
  const title = `Oferta ficticia descartable ${tag}`;
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createEvaluatedJob({ title, score: 8.8 });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("descartar avisa y «Deshacer» la devuelve a Por revisar", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByTestId("descartar-oferta")
      .click();
    await expect.poll(() => jobStatus(jobId)).toBe("descartada");
    await expect(page.getByTestId("aviso-descartada")).toHaveText("Oferta descartada.");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(0);

    await page.getByTestId("deshacer-descarte").click();
    await expect.poll(() => jobStatus(jobId)).toBe("evaluada");
    await expect(page.getByTestId("aviso-descartada")).toHaveCount(0);
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  });

  test("en Descartadas y en Todas: marca, «Volver a revisar» y «Ver oferta»", async ({ page }) => {
    await login(page);
    await page.goto("/jobs");
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByTestId("descartar-oferta")
      .click();
    await expect.poll(() => jobStatus(jobId)).toBe("descartada");

    for (const path of ["/jobs?estado=descartada", "/jobs?estado=todas"]) {
      await page.goto(path);
      const card = page.getByRole("listitem").filter({ hasText: title });
      await expect(card.getByTestId("marca-descartada")).toHaveText("Descartada por vos");
      await expect(card.getByRole("link", { name: "Ver oferta" })).toBeVisible();
      await expect(card.getByTestId("volver-a-revisar")).toHaveText("Volver a revisar");
      // Nada tachado y sin «Descartar» de nuevo
      await expect(card.getByRole("button", { name: /^Descartar/ })).toHaveCount(0);
      const decoration = await card
        .getByTestId("tarjeta-titulo")
        .evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect(decoration).not.toContain("line-through");
    }
  });

  test("«Volver a revisar» la devuelve a Por revisar", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=descartada");
    await page
      .getByRole("listitem")
      .filter({ hasText: title })
      .getByTestId("volver-a-revisar")
      .click();
    await expect.poll(() => jobStatus(jobId)).toBe("evaluada");
    await page.goto("/jobs");
    await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();
  });
});
