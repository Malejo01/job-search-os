import { expect, test, type Page } from "@playwright/test";
import * as s from "@job-search-os/db/schema";
import { eq } from "drizzle-orm";
import { createEvaluation, createJob, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 86 (JS-054): a igual score, la lista pone primero la oferta con menos riesgos. Sin LLM:
 * las dos evaluaciones se siembran a mano con el mismo score. La de 3 riesgos es la más nueva, así
 * el orden por fecha solo daría el contrario y el test prueba el criterio nuevo, no el viejo.
 * El score (9,05) no lo usa ningún otro flujo: con 7, el de casi todos, quedaban debajo de todo lo
 * sembrado y podían salir de las 100 primeras.
 */
const SCORE = 9.05;
test.describe("Flujo 86: a igual score, menos riesgos primero", () => {
  const tag = Date.now();
  const nombre = (n: string) => `E2E riesgos ${n} ${tag}`;
  const creados: string[] = [];

  test.beforeAll(async () => {
    const pocos = await createJob({ title: nombre("pocos"), status: "evaluada" });
    creados.push(pocos);
    await createEvaluation(pocos, { score: SCORE, riesgos: ["Sueldo no publicado"] });
    // Una hora más vieja que la de 3 riesgos: por fecha iría segunda
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.jobs)
        .set({ firstSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
        .where(eq(s.jobs.id, pocos));
    } finally {
      await close();
    }

    const muchos = await createJob({ title: nombre("muchos"), status: "evaluada" });
    creados.push(muchos);
    await createEvaluation(muchos, {
      score: SCORE,
      riesgos: ["Sueldo no publicado", "Empresa de staffing", "Guardias de fin de semana"],
    });
  });

  test.afterAll(async () => {
    for (const id of creados) await deleteJob(id);
  });

  /** Posición de cada una de las dos ofertas entre las tarjetas de la lista (-1 si no está). */
  async function posiciones(page: Page): Promise<{ pocos: number; muchos: number }> {
    const cards = page.getByRole("main").getByRole("listitem");
    await expect(cards.filter({ hasText: nombre("pocos") })).toBeVisible();
    await expect(cards.filter({ hasText: nombre("muchos") })).toBeVisible();
    const textos = await cards.allTextContents();
    return {
      pocos: textos.findIndex((t) => t.includes(nombre("pocos"))),
      muchos: textos.findIndex((t) => t.includes(nombre("muchos"))),
    };
  }

  test("la de 1 riesgo sale antes que la de 3, y el orden se mantiene al recargar", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/jobs");
    const primera = await posiciones(page);
    expect(primera.pocos, "la oferta de 1 riesgo está en la lista").toBeGreaterThanOrEqual(0);
    expect(primera.pocos, "la de 1 riesgo va antes que la de 3").toBeLessThan(primera.muchos);

    // Estable: la misma consulta devuelve el mismo orden
    await page.reload();
    const segunda = await posiciones(page);
    expect(segunda.pocos).toBeLessThan(segunda.muchos);
  });
});
