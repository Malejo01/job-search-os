import { expect, test, type Page } from "@playwright/test";
import { createEvaluation, createJob, deleteJob, login } from "./helpers";

/**
 * Flujo 115 (C9-14, decisión 13): los dos momentos de marca y «reducir movimiento».
 * - El sello se estampa la primera vez que se ve una oferta evaluada, y la segunda no.
 * - Con `reducedMotion: 'reduce'` no se anima nada: ni el sello, ni el anillo de C2.
 * Datos inventados.
 */
/**
 * Estilo inline que deja Framer en la caja del sello: vacío si nunca se animó. Con la estampa,
 * Framer escribe `transform` (y al terminar queda en su lugar, `none`).
 */
const inlineTransform = (page: Page) =>
  page
    .locator("[data-sello-estampa]")
    .first()
    .evaluate((el) => (el as HTMLElement).style.transform);

const seen = (page: Page) =>
  page.evaluate(() => {
    try {
      return window.localStorage.getItem("jso-sellos-vistos") ?? "";
    } catch {
      return "";
    }
  });

test.describe("Flujo 115: movimiento", () => {
  const tag = Date.now();
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({ title: `E2E sello estampa ${tag}`, status: "evaluada" });
    await createEvaluation(jobId, { score: 9 });
  });

  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
  });

  test("con «reducir movimiento»: el sello no se estampa y el anillo de C2 queda quieto", async ({
    browser,
  }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    try {
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      await expect(page.getByRole("img", { name: "puntaje 9" })).toBeVisible();
      // Primera visita: queda marcada como vista, pero sin animación
      await expect.poll(() => seen(page)).toContain(jobId);
      expect(await inlineTransform(page)).toBe("");
      await page.goto("/settings/marca/componentes");
      const ring = page
        .getByTestId("sellos-light")
        .getByRole("img", { name: "en cola" })
        .locator("span[aria-hidden]")
        .first();
      expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    } finally {
      await context.close();
    }
  });

  test("sin «reducir movimiento»: se estampa la primera vez y la segunda no", async ({ page }) => {
    await login(page);
    // El anillo del sello en cola gira (la única animación en loop)
    await page.goto("/settings/marca/componentes");
    const ring = page
      .getByTestId("sellos-light")
      .getByRole("img", { name: "en cola" })
      .locator("span[aria-hidden]")
      .first();
    expect(await ring.evaluate((el) => getComputedStyle(el).animationName)).toBe("spin");

    // La prueba anterior corrió en otro contexto: acá la oferta todavía no se vio
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByRole("img", { name: "puntaje 9" })).toBeVisible();
    await expect.poll(() => seen(page)).toContain(jobId);
    // Se animó (Framer dejó su estilo) y terminó en su lugar
    await expect.poll(() => inlineTransform(page)).not.toBe("");
    await expect
      .poll(() =>
        page
          .locator("[data-sello-estampa]")
          .first()
          .evaluate((el) => getComputedStyle(el).transform),
      )
      .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    // Segunda visita: no se anima
    await page.reload();
    await expect(page.getByRole("img", { name: "puntaje 9" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(await inlineTransform(page)).toBe("");
  });
});
