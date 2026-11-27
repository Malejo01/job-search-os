import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { avisoFicticio, cleanCards, createJobForB, deleteJobsOfB } from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";
import { JOB_CARD_MODE } from "./evaluacion-r31-helpers";

/**
 * Flujo 383 (R31-04): el detalle con la ficha lista. «La oferta en pocas palabras», «Qué vas a hacer» y «Qué
 * buscan» con su cita («Así lo dice el aviso») que se abre con el teclado; «Lo importante para decidir» trae la
 * cita en las filas que el aviso dice y «No especificado» en las demás. A 390 y 360 px sin scroll horizontal y sin
 * violaciones de axe. Modelo simulado (`LLM_DEMO=1`), datos inventados. Requiere `JOB_CARD=testers`.
 */
test.skip(JOB_CARD_MODE !== "testers", "necesita JOB_CARD=testers (E2E_JOB_CARD_MODE)");

test.describe("Flujo 383: la ficha en el detalle", () => {
  const tag = `383-${Date.now()}`;
  let jobId = "";
  let hash = "";

  test.beforeAll(async () => {
    const created = await createJobForB({
      title: `E2E ficha pantalla ${tag}`,
      jdText: avisoFicticio(tag),
    });
    jobId = created.jobId;
    hash = created.hash!;
    await cleanCards([hash]);
  });
  test.afterAll(async () => {
    await cleanCards([hash]);
    await deleteJobsOfB([jobId]);
  });

  test("los tres bloques y la cita con el teclado", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ficha-resumen").getByRole("heading", { level: 2 })).toHaveText(
      "La oferta en pocas palabras",
    );
    await expect(page.getByTestId("ficha-tareas").getByRole("heading", { level: 2 })).toHaveText(
      "Qué vas a hacer",
    );
    await expect(
      page.getByTestId("ficha-requisitos").getByRole("heading", { level: 2 }),
    ).toHaveText("Qué buscan");

    // La cita se abre con el teclado y es texto, nunca HTML
    const resumen = page.getByTestId("ficha-resumen");
    const resumen_cita = resumen.getByText("Así lo dice el aviso");
    await resumen_cita.focus();
    await page.keyboard.press("Enter");
    await expect(resumen.getByRole("blockquote")).toBeVisible();

    // «Lo importante para decidir»: siempre las 7 filas; lo que el aviso no dice, «No especificado»
    const cond = page.getByTestId("condiciones");
    await expect(cond.locator("[data-testid^='condicion-']")).toHaveCount(7);
    await expect(
      cond.getByTestId("ficha-cita").or(cond.getByText("No especificado")).first(),
    ).toBeVisible();
  });

  for (const width of [390, 360]) {
    test(`a ${width} px: sin scroll horizontal y axe sin violaciones`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await loginAsSecondUser(page);
      await page.goto(`/jobs/${jobId}`);
      await expect(page.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
      const { violations } = await axeSummary(page);
      expect(violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width,
      );
    });
  }
});
