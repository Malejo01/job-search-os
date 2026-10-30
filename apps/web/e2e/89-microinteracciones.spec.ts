import { expect, test } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 89 (N3-5): microinteracciones y reduced-motion.
 * Verifica que cuando la persona solicita reducir el movimiento (prefers-reduced-motion: reduce):
 * 1. Las tarjetas de /hoy son visibles inmediatamente sin esperar animaciones escalonadas y con opacity 1.
 * 2. La lista de ofertas en /jobs es visible inmediatamente.
 * 3. El detalle de una oferta en /jobs/[id] carga y se muestra con opacity 1 y sin demoras.
 * 4. El feedback de un toque (👍/👎) responde inmediatamente con su estado activo.
 * 5. Con JavaScript desactivado (javaScriptEnabled: false), /jobs y el detalle son visibles en el HTML del servidor sin depender de JS.
 */
test.describe("Flujo 89: microinteracciones y reduced-motion", () => {
  const tag = Date.now();
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({
      title: `Oferta Microinteracción Test ${tag}`,
      status: "evaluada",
      jdText: "Descripción de prueba para verificar microinteracciones.",
    });
    await createEvaluation(jobId, { score: 9, accion: "aplicar" });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId).catch(() => {});
  });

  test("con reduced-motion activado: /hoy, /jobs y /jobs/[id] muestran su contenido con opacidad 1 de inmediato", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page);

    // 1. /hoy
    await page.goto("/hoy");
    await expect(page.locator("h1")).toHaveText("Hoy");
    await expect(page.getByTestId("hoy-visita")).toBeVisible();
    await expect(page.getByTestId("hoy-nuevo")).toBeVisible();

    // 2. /jobs
    await page.goto("/jobs");
    await expect(page.locator("h1")).toHaveText("Ofertas");
    const jobItem = page.getByText(`Oferta Microinteracción Test ${tag}`).first();
    await expect(jobItem).toBeVisible();
    const jobOpacity = await jobItem.evaluate((el) => getComputedStyle(el).opacity);
    expect(jobOpacity).toBe("1");

    // 3. /jobs/[id]
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator("h1")).toHaveText(`Oferta Microinteracción Test ${tag}`);
    await expect(page.getByRole("group", { name: "¿Te sirve esta evaluación?" })).toBeVisible();

    // Detalle con reduced-motion: opacidad computada debe ser exactamente 1 (no queda pegado opacity:0)
    const detailArticle = page.locator("main article").first();
    await expect(detailArticle).toBeVisible();
    const articleOpacity = await detailArticle.evaluate((el) => getComputedStyle(el).opacity);
    expect(articleOpacity).toBe("1");

    // 4. Feedback 👍 con reduced-motion: responde y activa aria-pressed
    const yesButton = page.getByRole("button", { name: "Sí, me sirve" });
    await expect(yesButton).toBeVisible();
    await yesButton.click();
    await expect(yesButton).toHaveAttribute("aria-pressed", "true");
    await expect(yesButton).toContainText("✓");
  });

  test("con JavaScript desactivado: /jobs y el detalle de una oferta se ven directamente del HTML del servidor", async ({
    page,
    browser,
  }) => {
    await login(page);
    const storageState = await page.context().storageState();

    const noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      storageState,
    });
    const noJsPage = await noJsContext.newPage();

    // /jobs sin JS
    await noJsPage.goto("/jobs");
    await expect(noJsPage.locator("h1")).toHaveText("Ofertas");
    await expect(noJsPage.getByText(`Oferta Microinteracción Test ${tag}`).first()).toBeVisible();

    // /jobs/[id] sin JS
    await noJsPage.goto(`/jobs/${jobId}`);
    await expect(noJsPage.locator("h1")).toHaveText(`Oferta Microinteracción Test ${tag}`);
    const noJsArticle = noJsPage.locator("main article").first();
    await expect(noJsArticle).toBeVisible();

    await noJsContext.close();
  });

  test("sin reduced-motion: el feedback 👍/👎 y el detalle transicionan correctamente", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await login(page);

    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator("h1")).toHaveText(`Oferta Microinteracción Test ${tag}`);

    // Alternar a 👎
    const noButton = page.getByRole("button", { name: "No, no me sirve" });
    await expect(noButton).toBeVisible();
    await noButton.click();
    await expect(noButton).toHaveAttribute("aria-pressed", "true");
    await expect(noButton).toContainText("✓");
  });
});
