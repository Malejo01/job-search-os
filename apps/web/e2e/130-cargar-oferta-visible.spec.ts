import { expect, test } from "@playwright/test";
import { createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 130 (R6-1): «+ Cargar oferta» está siempre en la cabecera de /jobs, con o sin oferta
 * elegida y en el celular sin hacer scroll. Datos inventados; el título lleva Date.now().
 */
test.describe("Flujo 130: «+ Cargar oferta» siempre visible", () => {
  const tag = Date.now();
  let jobId: string;

  test.beforeAll(async () => {
    jobId = await createJob({
      title: `Analista contable ficticia ${tag}`,
      status: "evaluada",
    });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("con una oferta elegida en el panel el botón sigue a la vista", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/jobs?estado=todas&oferta=${jobId}`);
    await expect(page.getByTestId("tarjeta-oferta").first()).toBeVisible();
    const button = page.getByRole("link", { name: "+ Cargar oferta" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    await page.waitForURL("**/jobs/new");
  });

  test("a 390 px el botón está dentro de la pantalla sin scroll", async ({ page }) => {
    await login(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/jobs?estado=todas");
    const button = page.getByRole("link", { name: "+ Cargar oferta" });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
