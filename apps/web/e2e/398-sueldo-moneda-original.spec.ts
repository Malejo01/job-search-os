import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { deleteJob, login, ownerDb } from "./helpers";
import { createEvaluatedJob } from "./listado-helpers";

/**
 * Flujo 398 (R32-08): el sueldo se muestra tal como lo publica el aviso, en su moneda (pesos, dólares, euros,
 * reales). Una equivalencia en dólares, si existe, va aparte y dice que es aproximada. Lo guardado antes de la
 * R32 (sin sueldo original) se ve como siempre. Datos inventados, siempre con un tag en el título.
 *
 * Necesita la migración 0090 aplicada en la base local (`node .claude/bin/local.mjs migrate`).
 */
type Original = {
  min: number | null;
  max: number | null;
  currency: string;
  period: "mensual" | "anual" | "hora" | null;
};

async function setOriginal(
  jobId: string,
  original: Original,
  usd?: { min: number; max: number; period: string },
) {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.jobs)
      .set({
        salaryOriginalMin: original.min,
        salaryOriginalMax: original.max,
        salaryOriginalCurrency: original.currency,
        salaryOriginalPeriod: original.period,
        ...(usd ? { salaryMinUsd: usd.min, salaryMaxUsd: usd.max, salaryPeriod: usd.period } : {}),
      })
      .where(eq(s.jobs.id, jobId));
  } finally {
    await close();
  }
}

test.describe("Flujo 398: el sueldo en la moneda original", () => {
  const tag = Date.now();
  const titles = {
    pesos: `Oferta ficticia en pesos ${tag}`,
    dolares: `Oferta ficticia en dolares ${tag}`,
    euros: `Oferta ficticia en euros ${tag}`,
    reales: `Oferta ficticia en reales ${tag}`,
    viejo: `Oferta ficticia anterior ${tag}`,
  };
  const ids: Record<keyof typeof titles, string> = {
    pesos: "",
    dolares: "",
    euros: "",
    reales: "",
    viejo: "",
  };

  test.beforeAll(async () => {
    let score = 9.9;
    for (const key of Object.keys(titles) as (keyof typeof titles)[]) {
      ids[key] = await createEvaluatedJob({
        title: titles[key],
        score: (score -= 0.1),
        // La anterior a la R32 solo tiene los dólares de siempre
        salary: key === "viejo" ? { min: 350, max: 870, period: "mensual" } : undefined,
      });
    }
    // Pesos con una equivalencia en dólares que la fuente sí dio
    await setOriginal(
      ids.pesos,
      { min: 1_200_000, max: 1_500_000, currency: "ARS", period: "mensual" },
      { min: 1200, max: 1500, period: "mensual" },
    );
    await setOriginal(ids.dolares, { min: 3000, max: 4500, currency: "USD", period: "mensual" });
    await setOriginal(ids.euros, { min: 45_000, max: 60_000, currency: "EUR", period: "anual" });
    await setOriginal(ids.reales, { min: 8000, max: 12_000, currency: "BRL", period: "mensual" });
  });

  test.afterAll(async () => {
    for (const id of Object.values(ids)) if (id) await deleteJob(id);
  });

  test("la tarjeta dice el sueldo en su moneda, y lo anterior sigue en dólares", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const salaryOf = (title: string) =>
      page.getByRole("listitem").filter({ hasText: title }).getByTestId("tarjeta-salario");
    await expect(salaryOf(titles.pesos)).toHaveText("$ 1.200.000 a $ 1.500.000 por mes (ARS)");
    await expect(salaryOf(titles.dolares)).toHaveText("US$ 3.000 a US$ 4.500 por mes (USD)");
    await expect(salaryOf(titles.euros)).toHaveText("€ 45.000 a € 60.000 por año (EUR)");
    await expect(salaryOf(titles.reales)).toHaveText("R$ 8.000 a R$ 12.000 por mes (BRL)");
    await expect(salaryOf(titles.viejo)).toHaveText("USD 350–870 por mes");
  });

  test("el detalle muestra el original y, aparte, la equivalencia aproximada", async ({ page }) => {
    await login(page);
    await page.goto(`/jobs/${ids.pesos}`);
    await expect(page.getByText("$ 1.200.000 a $ 1.500.000 por mes (ARS)").first()).toBeVisible();
    const equivalencia = page.getByTestId("salario-equivalencia");
    await expect(equivalencia).toContainText("aproximado");
    await expect(equivalencia).toContainText("US$ 1.200 a US$ 1.500");
    // La equivalencia no reemplaza al sueldo: el original sigue visible arriba
    await expect(page.getByText("1200–1500")).toHaveCount(0);
  });

  test("sin equivalencia no hay nada aparte, y un aviso anterior se ve como siempre", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${ids.euros}`);
    await expect(page.getByText("€ 45.000 a € 60.000 por año (EUR)").first()).toBeVisible();
    await expect(page.getByTestId("salario-equivalencia")).toHaveCount(0);

    await page.goto(`/jobs/${ids.viejo}`);
    await expect(page.getByText("USD 350–870 mensual").first()).toBeVisible();
    await expect(page.getByTestId("salario-equivalencia")).toHaveCount(0);
  });
});
