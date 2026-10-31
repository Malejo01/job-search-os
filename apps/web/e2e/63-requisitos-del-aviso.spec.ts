import * as s from "@job-search-os/db/schema";
import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createEvaluation, createJob, deleteJob, E2E_USER_ID, login, ownerDb } from "./helpers";

/**
 * Flujo 63 (ronda 104): «Requisitos del aviso» sale de `decision.checklist`. Con el checklist se ve
 * el titular, un ítem de cada estado y la primera mirada del reclutador; sin él (evaluaciones
 * viejas) o con una forma inválida, la página queda como antes. Avisos y datos inventados.
 */
// `id` obligatorio y distinto en cada ítem de prueba (React lo usa como key)
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

const ANOS = item({ id: "anos", pide: "5 años de experiencia", tenes: "6 años" });
const INGLES = item({
  id: "ingles",
  pide: "Inglés avanzado",
  tenes: "B2",
  status: "no_cumple",
});
// `docker` está en la taxonomía: el detalle superpone los niveles de hoy (C-20), así que el setup le
// quita el nivel al usuario e2e y lo restaura al terminar. `zz_redis_e2e` no está en la taxonomía:
// su estado guardado no cambia y linkea a Ajustes en vez de mostrar el botón.
const DOCKER = item({
  id: "skill:docker",
  kind: "skill",
  pide: "Docker",
  status: "no_se_sabe",
  fuente: { pide: "modelo", tenes: null },
  evidencia: "experiencia con contenedores",
});
const NOMBRADA = item({
  id: "skill:zz_redis_e2e",
  kind: "skill",
  nivel: "deseable",
  pide: "Redis",
  tenes: "nivel 2",
  fuente: { pide: "fuente", tenes: "skills" },
});

const CHECKLIST = {
  items: [ANOS, INGLES, DOCKER, NOMBRADA],
  must: { cumple: 1, no_cumple: 1, no_se_sabe: 1 },
  deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
  parcial: true,
  descarte_rapido: INGLES,
};

async function evaluateWithDecision(jobId: string, decision: unknown): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.evaluations).values({
      jobId,
      userId: E2E_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: false,
      score: 6,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación de prueba (e2e).",
      accion: "guardar",
      decision,
    });
  } finally {
    await close();
  }
}

test.describe("Flujo 63: requisitos del aviso", () => {
  let dockerBackup: (typeof s.skillLevels.$inferSelect)[] = [];

  test.beforeAll(async () => {
    const { db, close } = ownerDb();
    try {
      const [docker] = await db
        .select({ id: s.skills.id })
        .from(s.skills)
        .where(eq(s.skills.slug, "docker"));
      const mine = and(
        eq(s.skillLevels.userId, E2E_USER_ID),
        eq(s.skillLevels.skillId, docker!.id),
      );
      dockerBackup = await db.select().from(s.skillLevels).where(mine);
      await db.delete(s.skillLevels).where(mine);
    } finally {
      await close();
    }
  });

  test.afterAll(async () => {
    const { db, close } = ownerDb();
    try {
      if (dockerBackup.length) {
        await db.insert(s.skillLevels).values(dockerBackup).onConflictDoNothing();
      }
    } finally {
      await close();
    }
  });

  test("con checklist: titular, un ítem de cada estado y la primera mirada", async ({ page }) => {
    const jobId = await createJob({ title: "E2E requisitos con checklist", status: "evaluada" });
    try {
      await evaluateWithDecision(jobId, { checklist: CHECKLIST });
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const section = page.getByRole("region", { name: "Requisitos del aviso" });
      await expect(section.getByTestId("requisitos-titular")).toContainText(
        "Cumplís 1 de 2 requisitos excluyentes y 1 que no podemos verificar con tu perfil",
      );
      await expect(section).toContainText("Sin la descripción completa");
      // Un ítem de cada estado, con texto y no solo color
      await expect(section.getByText("Cumple", { exact: true }).first()).toBeVisible();
      await expect(section.getByText("No cumple", { exact: true })).toBeVisible();
      await expect(section.getByText("No se sabe", { exact: true })).toBeVisible();
      // Lo desconocido pide cargar el nivel con un botón que abre el modal (C-20), no con un link
      await expect(
        section.getByRole("button", { name: "Cargar mi nivel de Docker" }),
      ).toBeVisible();
      // Skills que solo nombra el aviso, aparte del titular
      await expect(
        section.getByRole("heading", { name: "Skills que nombra el aviso" }),
      ).toBeVisible();
      await expect(section.getByTestId("requisitos-descarte")).toContainText(
        "Lo primero por lo que te descartarían: Inglés avanzado (tenés B2)",
      );
    } finally {
      await deleteJob(jobId);
    }
  });

  test("una skill fuera de la taxonomía linkea a Ajustes y no muestra el botón", async ({
    page,
  }) => {
    const jobId = await createJob({
      title: "E2E requisitos skill sin taxonomia",
      status: "evaluada",
    });
    try {
      const rara = item({
        id: "skill:zz_sin_taxonomia_e2e",
        kind: "skill",
        nivel: "deseable",
        pide: "Menciona Cosa Rara",
        status: "no_se_sabe",
        fuente: { pide: "fuente", tenes: null },
      });
      await evaluateWithDecision(jobId, {
        checklist: {
          items: [rara],
          must: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
          deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 1 },
          parcial: false,
          descarte_rapido: null,
        },
      });
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const section = page.getByRole("region", { name: "Requisitos del aviso" });
      await expect(
        section.getByRole("link", { name: "Cargá tu nivel de Cosa Rara" }),
      ).toHaveAttribute("href", "/settings/skills");
      await expect(section.getByRole("button", { name: /Cargar mi nivel/ })).toHaveCount(0);
    } finally {
      await deleteJob(jobId);
    }
  });

  test("el CTA a «Tu perfil» solo en años, inglés y jornada; el resto sin link", async ({
    page,
  }) => {
    const jobId = await createJob({ title: "E2E requisitos cta", status: "evaluada" });
    try {
      const anos = item({ id: "anos", pide: "5 años", status: "no_se_sabe" });
      const pais = item({ id: "pais", pide: "Ubicación permitida", status: "no_se_sabe" });
      const salario = item({
        id: "salario",
        pide: "Salario publicado",
        status: "no_se_sabe",
        nota: "salario leído del texto del aviso",
      });
      await evaluateWithDecision(jobId, {
        checklist: {
          items: [anos, pais, salario],
          must: { cumple: 0, no_cumple: 0, no_se_sabe: 3 },
          deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
          parcial: false,
          descarte_rapido: null,
        },
      });
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const section = page.getByRole("region", { name: "Requisitos del aviso" });
      await expect(
        section.getByRole("link", { name: "Completá este dato en Tu perfil: 5 años" }),
      ).toHaveAttribute("href", "/settings/perfil");
      await expect(section.getByRole("link")).toHaveCount(1);
      // La aclaración del código se ve debajo del ítem
      await expect(section.getByTestId("requisito-nota")).toHaveText(
        "salario leído del texto del aviso",
      );
    } finally {
      await deleteJob(jobId);
    }
  });

  test("sin checklist (evaluación vieja) o inválido: la página queda como antes", async ({
    page,
  }) => {
    const sin = await createJob({ title: "E2E requisitos sin checklist", status: "evaluada" });
    const roto = await createJob({ title: "E2E requisitos checklist roto", status: "evaluada" });
    try {
      await createEvaluation(sin);
      await evaluateWithDecision(roto, { checklist: { items: "no es una lista" } });
      await login(page);
      for (const id of [sin, roto]) {
        await page.goto(`/jobs/${id}`);
        await expect(page.getByRole("heading", { name: "Te falta o te frena" })).toBeVisible();
        await expect(page.getByRole("region", { name: "Requisitos del aviso" })).toHaveCount(0);
      }
    } finally {
      await deleteJob(sin);
      await deleteJob(roto);
    }
  });

  test("sin requisitos excluyentes verificables: lo dice y no inventa un X de Y", async ({
    page,
  }) => {
    const jobId = await createJob({ title: "E2E requisitos vacio", status: "evaluada" });
    try {
      await evaluateWithDecision(jobId, {
        checklist: {
          items: [],
          must: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
          deseable: { cumple: 0, no_cumple: 0, no_se_sabe: 0 },
          parcial: false,
          descarte_rapido: null,
        },
      });
      await login(page);
      await page.goto(`/jobs/${jobId}`);
      const section = page.getByRole("region", { name: "Requisitos del aviso" });
      await expect(section.getByTestId("requisitos-titular")).toHaveText(
        "No hay requisitos verificables; mirá la lista",
      );
      await expect(section.getByTestId("requisitos-descarte")).toContainText(
        "Nada evidente: tu perfil pasa la primera mirada",
      );
    } finally {
      await deleteJob(jobId);
    }
  });
});
