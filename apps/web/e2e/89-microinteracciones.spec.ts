import { expect, test } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 89 (N3-5): microinteracciones y reduced-motion.
 * Verifica que cuando la persona solicita reducir el movimiento (prefers-reduced-motion: reduce):
 * 1. Las tarjetas de /hoy son visibles inmediatamente sin esperar animaciones escalonadas.
 * 2. La lista de ofertas en /jobs es visible inmediatamente.
 * 3. El detalle de una oferta en /jobs/[id] carga y se muestra sin demoras.
 * 4. El feedback de un toque (👍/👎) responde inmediatamente con su estado activo.
 * Y en modo normal (sin reduced-motion), las microinteracciones se renderizan correctamente.
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

  test("con reduced-motion activado: /hoy, /jobs y /jobs/[id] muestran su contenido de inmediato", async ({
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
    await expect(page.getByText(`Oferta Microinteracción Test ${tag}`).first()).toBeVisible();

    // 3. /jobs/[id]
    await page.goto(`/jobs/${jobId}`);
    await expect(page.locator("h1")).toHaveText(`Oferta Microinteracción Test ${tag}`);
    await expect(page.getByRole("group", { name: "¿Te sirve esta evaluación?" })).toBeVisible();

    // 4. Feedback 👍 con reduced-motion: responde y activa aria-pressed
    const yesButton = page.getByRole("button", { name: "Sí, me sirve" });
    await expect(yesButton).toBeVisible();
    await yesButton.click();
    await expect(yesButton).toHaveAttribute("aria-pressed", "true");
    await expect(yesButton).toContainText("✓");
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
