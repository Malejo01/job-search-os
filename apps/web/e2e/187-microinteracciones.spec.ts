import { expect, test } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 187 (R23-06): microinteracciones. El detalle del sello crece al abrirse y sus barras se
 * llenan; con «reducir movimiento» queda todo en su estado final sin pasar por altura 0. «Dictar»
 * muestra «Escuchando…» con la voz simulada. Datos inventados.
 */
test.describe("Flujo 187: microinteracciones", () => {
  const tag = Date.now();
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({ title: `E2E microinteracciones ${tag}`, status: "evaluada" });
    await createEvaluation(jobId, { score: 8 });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("el detalle se abre y las barras terminan en su ancho final", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const detail = page.getByTestId("afinidad-detalle");
    await expect(detail).toBeVisible();
    await detail.getByText("Ver cómo se compone el puntaje").click();
    await expect(detail).toHaveAttribute("open", "");
    const meter = detail.getByRole("meter").first();
    await expect(meter).toBeVisible();
    // Al terminar la transición el relleno mide lo que dice el medidor
    const now = Number(await meter.getAttribute("aria-valuenow"));
    await expect
      .poll(async () =>
        meter.evaluate((el) => {
          const fill = el.firstElementChild as HTMLElement;
          return Math.round(
            (fill.getBoundingClientRect().width / el.getBoundingClientRect().width) * 10,
          );
        }),
      )
      .toBe(Math.round(now));
    // El panel no queda con una altura fija ni recortado
    await expect
      .poll(() =>
        detail
          .locator("div.overflow-hidden")
          .first()
          .evaluate((el) => el.style.height),
      )
      .toBe("auto");
  });

  test("con «reducir movimiento» el detalle abre ya en su estado final", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const detail = page.getByTestId("afinidad-detalle");
      await detail.getByText("Ver cómo se compone el puntaje").click();
      const panel = detail.locator("div.overflow-hidden").first();
      expect(await panel.evaluate((el) => el.style.height)).toBe("auto");
      expect(await panel.evaluate((el) => el.style.opacity)).toBe("1");
    } finally {
      await context.close();
    }
  });

  test("Dictar muestra «Escuchando…» mientras se dicta", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRecognition {
        onstart: (() => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          setTimeout(() => this.onstart?.(), 0);
        }
        stop() {
          setTimeout(() => this.onend?.(), 0);
        }
        abort() {
          this.stop();
        }
      }
      Object.assign(window, {
        SpeechRecognition: FakeRecognition,
        webkitSpeechRecognition: FakeRecognition,
      });
    });
    await login(page);
    await page.goto("/cv");
    const boton = page.getByTestId("dictar-boton");
    // Sin el chat del coach en pantalla (sin CV cargado) no hay botón: no se puede comprobar acá
    test.skip((await boton.count()) === 0, "el botón Dictar no está en /cv sin CV");
    await boton.click();
    await expect(page.getByTestId("dictar-escuchando")).toContainText("Escuchando");
    await boton.click();
    await expect(page.getByTestId("dictar-escuchando")).not.toContainText("Escuchando");
  });
});
