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
    await expect(card.getByText("A tu favor: Excel ficticio")).toBeVisible();
    await expect(card.getByText("Te frena: Bloqueador ficticio")).toBeVisible();

    await page.goto(`/jobs/${jobId}`);
    const favor = page.getByTestId("fit-favor");
    await expect(favor.getByRole("heading", { name: "A tu favor" })).toBeVisible();
    await expect(favor.getByText("Excel ficticio")).toBeVisible();
    await expect(favor.getByText("Atención al cliente ficticia")).toBeVisible();
    await expect(favor.getByText("Pocos candidatos")).toBeVisible();
    const falta = page.getByTestId("fit-falta");
    await expect(falta.getByRole("heading", { name: "Te falta o te frena" })).toBeVisible();
    await expect(falta.getByText("Te frena: Bloqueador ficticio")).toBeVisible();
    await expect(falta.getByText("Facturación ficticia")).toBeVisible();
    await expect(falta.getByText("Ojo: Riesgo ficticio")).toBeVisible();
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
