import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { axeSummary } from "./axe-helpers";
import { createJob, deleteJob, E2E_USER_ID, login, ownerDb } from "./helpers";
import { blankProfileFacts } from "./perfil-sin-datos-helper";

/**
 * Flujo 359 (R30-08/09): detalle evaluado con una condición excluyente que no coincide. «Cómo
 * encaja» sale de la tabla de requisitos, la condición se explica aparte de la afinidad y el estado
 * «Sin confirmar» no se vuelve «No coincide». Datos inventados.
 */
const item = (over: { id: string } & Record<string, unknown>) => ({
  kind: "estructurado",
  nivel: "must",
  pide: over.id,
  evidencia: null,
  tenes: null,
  status: "cumple",
  fuente: { pide: "fuente", tenes: "perfil" },
  bloquea: false,
  ...over,
});

const RESIDENCIA = item({
  id: "residencia",
  pide: "Residir en el país del aviso",
  tenes: "AR",
  status: "no_cumple",
  bloquea: true,
});
const ANOS = item({ id: "anos", pide: "5 años de experiencia", tenes: null, status: "no_se_sabe" });
const MODALIDAD = item({ id: "modalidad", pide: "Modalidad remoto", tenes: "Aceptás: remoto" });

test.describe("Flujo 359: detalle con condición excluyente", () => {
  let jobId = "";
  let restoreProfile: () => Promise<void> = async () => {};
  test.beforeAll(async () => {
    // «5 años de experiencia» tiene que quedar «Sin confirmar»: el perfil del CI trae 5 años y el detalle
    // lo superpone a la evaluación («Coincide · En tu perfil: 5 años»). Ver `perfil-sin-datos-helper.ts`.
    restoreProfile = await blankProfileFacts();
    jobId = await createJob({
      title: `E2E detalle excluyente ${Date.now()}`,
      status: "evaluada",
      jdText: "Descripción ficticia con una condición excluyente de residencia.",
    });
    const { db, close } = ownerDb();
    try {
      await db.insert(s.evaluations).values({
        jobId,
        userId: E2E_USER_ID,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@e2e",
        model: "fake",
        hadFullJd: true,
        score: 8,
        locationOk: "no",
        modality: "remoto",
        discipline: "ai_engineer",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: ["residencia exigida en Empresa A"],
        senalesPositivas: [],
        veredicto: "Evaluación de prueba (e2e).",
        accion: "descartar",
        decision: {
          checklist: {
            items: [RESIDENCIA, ANOS, MODALIDAD],
            must: { cumple: 1, no_cumple: 1, no_se_sabe: 1 },
            deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
            parcial: false,
            descarte_rapido: RESIDENCIA,
          },
        },
      });
    } finally {
      await close();
    }
  });
  test.afterAll(async () => {
    if (jobId) await deleteJob(jobId);
    await restoreProfile();
  });

  test("la condición se explica aparte, lo que pesa sale de la tabla y lo sin dato es «Sin confirmar»", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    const encaja = page.getByTestId("como-encaja");
    await expect(encaja.getByTestId("como-encaja-veredicto")).toContainText(
      "condición del aviso que hoy no coincide",
    );
    const condicion = encaja.getByTestId("condicion-excluyente");
    await expect(condicion).toContainText("Residir en el país del aviso");
    await expect(condicion).toContainText("se explica aparte del puntaje");
    // Lo que más pesa: la condición primero; el dato sin cargar no es «No coincide»
    await expect(encaja.getByTestId("encaja-anos")).toContainText("Sin confirmar");
    await expect(encaja.getByTestId("encaja-anos")).not.toContainText("No coincide");
    // La aclaración fija se ve sin abrir nada
    await expect(page.getByTestId("afinidad-aclaracion")).toBeVisible();
    // Frases prohibidas fuera
    const cuerpo = page.locator("body");
    await expect(cuerpo).not.toContainText(/impide postular|te falta/i);
  });

  test("a 390 px: sin scroll horizontal y axe sin violaciones", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await login(page);
    await page.goto(`/jobs/${jobId}`);
    await expect(page.getByTestId("como-encaja")).toBeVisible();
    const { violations } = await axeSummary(page);
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
  });
});
