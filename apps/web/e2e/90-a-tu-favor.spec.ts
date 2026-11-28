import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { axeSummary } from "./axe-helpers";
import { createEvaluation, createJob, deleteJob, login, ownerDb } from "./helpers";

/**
 * Flujo 90 (C2-2): «A tu favor» y «Te falta o te frena». La tarjeta de /jobs muestra un punto de
 * cada lista; el detalle, la lista completa (hasta 5). Todo sale de lo que la evaluación ya guardó,
 * sin llamadas al modelo. Datos inventados. axe en claro y oscuro, a 360 px.
 */
test.describe("Flujo 90: A tu favor / Te falta o te frena", () => {
  const tag = Date.now();
  const title = `Oferta Ficticia Fortalezas ${tag}`;
  let jobId = "";

  test.beforeAll(async () => {
    jobId = await createJob({
      title,
      status: "evaluada",
      jdText: "Descripción ficticia para el flujo de fortalezas.",
    });
    await createEvaluation(jobId, { score: 6, accion: "guardar" });
    const { db, close } = ownerDb();
    try {
      await db
        .update(s.evaluations)
        .set({
          matchFuerte: ["Excel ficticio", "Atención al cliente ficticia"],
          senalesPositivas: ["Pocos candidatos"],
          gaps: ["Facturación ficticia"],
          bloqueadoresDuros: ["Bloqueador ficticio"],
          riesgos: ["Riesgo ficticio"],
        })
        .where(eq(s.evaluations.jobId, jobId));
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    await deleteJob(jobId);
  });

  test("la tarjeta resume 1 y 1; el detalle muestra las dos listas", async ({ page }) => {
    await login(page);
    await page.goto("/jobs?estado=todas");
    const card = page.getByRole("listitem").filter({ hasText: title }).first();
    // R30-04: la tarjeta ya no resume fortalezas ni brechas del modelo; solo dice lo que sale de la
    // tabla de requisitos (esta evaluación no trae tabla: ninguna línea) y trae sus tres botones
    await expect(card.getByTestId("tarjeta-titulo")).toHaveText(title);
    await expect(card.getByText("Excel ficticio")).toHaveCount(0);
    await expect(card.getByText("Facturación ficticia")).toHaveCount(0);
    await expect(card.getByText(/Te frena/)).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Ver oferta" })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Guardar/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /^Descartar/ })).toBeVisible();

    await page.goto(`/jobs/${jobId}`);
    // R30-09: el detalle ya no mezcla fortalezas, brechas y riesgos del modelo: todo sale de la
    // tabla de requisitos («Cómo encaja»); los riesgos quedan en «Cómo se calculó»
    await expect(page.getByTestId("como-encaja")).toBeVisible();
    await expect(page.getByTestId("fit-favor")).toHaveCount(0);
    await expect(page.getByTestId("fit-falta")).toHaveCount(0);
    await expect(page.getByTestId("seccion-como-se-calculo")).toContainText("Riesgo ficticio");
  });

  for (const tema of ["claro", "oscuro"] as const) {
    test(`axe en ${tema} a 360 px, sin scroll horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.addInitScript((t) => localStorage.setItem("jso-tema", t), tema);
      await login(page);
      for (const path of ["/jobs?estado=todas", `/jobs/${jobId}`]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const { violations, unmeasured } = await axeSummary(page);
        expect(violations, `${path} en ${tema}`).toEqual([]);
        expect(unmeasured, `${path} en ${tema}`).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          360,
        );
      }
    });
  }
});
