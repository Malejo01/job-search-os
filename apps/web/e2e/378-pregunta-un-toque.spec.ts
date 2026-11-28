import { expect, test } from "@playwright/test";
import { E2E_B_USER_ID, ensureSecondUser, loginAsSecondUser, removeSecondUser } from "./helpers";
import { ensureOffUser, loginAsOffUser, removeOffUser } from "./voz-helpers";
import {
  deleteJobs,
  deleteRequirementAnswers,
  JOB_CARD_MODE,
  requirementAnswersOf,
  seedEvaluatedJob,
} from "./evaluacion-r31-helpers";

/**
 * Flujo 378 (R31-05): la pregunta de un toque. Una fila «Sin confirmar» de lo que pide el aviso ofrece «Sí», «No»
 * o «En parte». La respuesta se guarda en el perfil y vale para las demás ofertas que pidan lo mismo: contestar en
 * una cambia el estado en las dos, sin volver a evaluar. «En parte» sigue sin confirmar y guarda la nota. Con
 * `JOB_CARD` apagada la pregunta no se ofrece. Se siembra la tabla ya guardada de dos ofertas con la misma
 * `clave`; no llama a ningún modelo. Todo inventado.
 *
 * Depende de que el detalle muestre `PreguntaUnToque` en la fila (`requisitos-del-aviso.tsx`) y de que la lectura
 * aplique `applyRequirementAnswers` a la tabla guardada.
 */
test.describe.configure({ mode: "serial" });

const CLAVE = "formacion:titulo universitario";
const FILA = "Título universitario";

function checklistConPregunta() {
  const row = {
    id: "req:1",
    kind: "texto",
    nivel: "must",
    pide: FILA,
    evidencia: "Título universitario o terciario",
    tenes: null,
    status: "no_se_sabe",
    fuente: { pide: "modelo", tenes: null },
    bloquea: false,
    pregunta: { clave: CLAVE, respuesta: null, nota: null },
  };
  return {
    items: [row],
    must: { cumple: 0, no_cumple: 0, no_se_sabe: 1 },
    deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
    parcial: false,
    descarte_rapido: null,
  };
}

const jobIds: string[] = [];
let ofertaA = "";
let ofertaB = "";

// La persona B es la que está en la etapa `testers` (ASSISTANT_TESTER_EMAILS); la A no, en local
test.beforeAll(async () => {
  await ensureSecondUser();
  await deleteRequirementAnswers(E2E_B_USER_ID);
  const a = await seedEvaluatedJob({
    userId: E2E_B_USER_ID,
    tag: "PA",
    title: "Pregunta un toque A",
    checklist: checklistConPregunta(),
  });
  const b = await seedEvaluatedJob({
    userId: E2E_B_USER_ID,
    tag: "PB",
    title: "Pregunta un toque B",
    checklist: checklistConPregunta(),
  });
  ofertaA = a.jobId;
  ofertaB = b.jobId;
  jobIds.push(a.jobId, b.jobId);
});
test.afterAll(async () => {
  await deleteJobs(jobIds);
  await deleteRequirementAnswers(E2E_B_USER_ID);
  await removeSecondUser();
});

test.describe("con JOB_CARD encendida", () => {
  test.skip(JOB_CARD_MODE !== "testers", "necesita JOB_CARD=testers (E2E_JOB_CARD_MODE)");

  test("«No» en una oferta cambia la fila en las dos, sin volver a evaluar", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${ofertaA}`);
    const grupo = page.getByRole("group", { name: `Tu respuesta sobre: ${FILA}` });
    await expect(grupo.getByText("¿Tenés esto?")).toBeVisible();
    await expect(page.getByText("Sin confirmar").first()).toBeVisible();
    await grupo.getByRole("button", { name: "No", exact: true }).click();
    await expect
      .poll(async () => (await requirementAnswersOf(E2E_B_USER_ID)).map((r) => r.answer))
      .toEqual(["no"]);

    for (const id of [ofertaA, ofertaB]) {
      await page.goto(`/jobs/${id}`);
      const fila = page.getByRole("listitem").filter({ hasText: FILA });
      await expect(fila.getByText("No coincide", { exact: true }).first()).toBeVisible();
      await expect(fila.getByTestId("pregunta-respondida")).toContainText("Tu respuesta: No");
    }
  });

  test("«En parte» sigue sin confirmar y guarda la nota", async ({ page }) => {
    await loginAsSecondUser(page);
    await page.goto(`/jobs/${ofertaB}`);
    await page.getByRole("button", { name: "Cambiar mi respuesta" }).click();
    const grupo = page.getByRole("group", { name: `Tu respuesta sobre: ${FILA}` });
    await grupo.getByRole("button", { name: "En parte", exact: true }).click();
    await page.getByLabel("Contanos en qué medida (opcional)").fill("Cursando el último año");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await expect
      .poll(async () => (await requirementAnswersOf(E2E_B_USER_ID)).map((r) => r.note))
      .toEqual(["Cursando el último año"]);
    await page.goto(`/jobs/${ofertaA}`);
    const fila = page.getByRole("listitem").filter({ hasText: FILA });
    await expect(fila.getByText("Sin confirmar", { exact: true }).first()).toBeVisible();
    await expect(fila.getByText("Cursando el último año").first()).toBeVisible();
  });
});

test.describe("sin JOB_CARD para la persona", () => {
  // Una persona sin rol (no la A: en el CI es admin y con `testers` ve la ficha): con la variable apagada, o
  // encendida solo para testers, la pregunta no se ofrece
  let ofertaOff = "";
  test.beforeAll(async () => {
    const offId = await ensureOffUser();
    const o = await seedEvaluatedJob({
      userId: offId,
      tag: "PO",
      title: "Pregunta un toque sin ficha",
      checklist: checklistConPregunta(),
    });
    ofertaOff = o.jobId;
    jobIds.push(o.jobId);
  });
  test.afterAll(async () => {
    await removeOffUser();
  });

  test("la pregunta no se ofrece y la tabla queda como al cerrar la R30", async ({ page }) => {
    await loginAsOffUser(page);
    await page.goto(`/jobs/${ofertaOff}`);
    await expect(page.getByRole("group", { name: /^Tu respuesta sobre:/ })).toHaveCount(0);
    await expect(page.getByTestId("pregunta-un-toque")).toHaveCount(0);
  });
});
