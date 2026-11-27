import { expect, test } from "@playwright/test";
import {
  avisoFicticio,
  cardCalls,
  cardRow,
  cleanCards,
  createJobForB,
  deleteJobsOfB,
} from "./ficha-helpers";
import { loginAsSecondUser } from "./helpers";

/**
 * Flujo 370 (R31-03): abrir un detalle sin ficha y verla aparecer. La persona B (tester, `JOB_CARD=testers`)
 * abre un aviso al que todavía no se le generó la ficha: ve «Preparando el resumen…» sin que la página se
 * mueva, la ficha se genera una sola vez con el modelo simulado (`LLM_DEMO=1`) y aparece sola. Datos
 * inventados. Requiere `JOB_CARD: "testers"` en el webServer de playwright.config.ts.
 */
test.describe("Flujo 370: la ficha aparece al abrir el detalle", () => {
  const tag = `370-${Date.now()}`;
  const jdText = avisoFicticio(tag);
  let jobId = "";
  let hash = "";

  test.beforeAll(async () => {
    const created = await createJobForB({ title: `E2E ficha aparece ${tag}`, jdText });
    jobId = created.jobId;
    hash = created.hash!;
    await cleanCards([hash]);
  });
  test.afterAll(async () => {
    await cleanCards([hash]);
    await deleteJobsOfB([jobId]);
  });

  test("«Preparando el resumen…» y después la ficha, con su cita", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);

    // Sin ficha: o ya está el aviso de que se prepara o, si el modelo simulado fue más rápido, la ficha
    const estado = page.getByTestId("ficha-estado");
    const resumen = page.getByTestId("ficha-resumen");
    await expect(estado.or(resumen)).toBeVisible();

    // La página se refresca sola hasta que la ficha está lista
    await expect(resumen).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ficha-estado")).toHaveCount(0);
    await expect(page.getByTestId("ficha-tareas")).toContainText("Diseñar agentes");
    await expect(page.getByTestId("ficha-requisitos")).toContainText("Manejo de Python");

    // Cada dato trae su cita literal, plegada
    await page.getByTestId("ficha-tareas").getByText("Así lo dice el aviso").first().click();
    await expect(page.getByTestId("ficha-tareas").getByRole("blockquote")).toBeVisible();

    // Una sola ficha y una sola llamada al modelo, sin persona asociada
    const row = await cardRow(hash);
    expect(row).toMatchObject({ status: "lista", attempts: 1, model: "fake" });
    const calls = await cardCalls(hash);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.userId).toBeNull();
  });

  test("una oferta vieja con jd_hash nulo también ve su ficha (se completa el hash)", async ({
    page,
  }) => {
    const viejo = await createJobForB({
      title: `E2E ficha oferta vieja ${tag}`,
      jdText: avisoFicticio(`${tag}-vieja`),
      withHash: false,
    });
    try {
      await loginAsSecondUser(page);
      await page.goto(`/jobs/${viejo.jobId}`);
      await expect(page.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
    } finally {
      await cleanCards([viejo.hash]);
      await deleteJobsOfB([viejo.jobId]);
    }
  });

  test("al volver a abrirlo no se vuelve a llamar al modelo", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("ficha-resumen")).toBeVisible({ timeout: 30_000 });
    expect(await cardCalls(hash)).toHaveLength(1);
  });
});
