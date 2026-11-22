import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createFakeLlm } from "../llm/fake";
import { ingestRawJob } from "../ingest/ingest-job";
import { reserveLlmSpend } from "../llm/spend-reserve";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/**
 * Parte reservada del tope global: el piso de quien casi no gastó mide el gasto de evaluaciones y
 * borradores, no el del chat y las lecturas de CV (que tienen su propio presupuesto), igual que el total.
 */
const CV_USER = "d6000000-0000-4000-8000-000000000001";
const OTHER = "d6000000-0000-4000-8000-000000000002";
const CAP = 2; // la parte reservada empieza en USD 1,6
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const raw = (externalId: string): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "Fuente A",
    externalId,
    url: `https://example.test/jobs/${externalId}`,
    rawRef: null,
  },
  title: "AI Engineer",
  companyRaw: `Empresa ${externalId}`,
  locationRaw: "Remoto (Argentina, Chile)",
  countriesAllowed: ["AR", "CL"],
  modality: "remoto",
  contractType: "Full time",
  salaryMinUsd: 3000,
  salaryMaxUsd: 4000,
  salaryPeriod: "mensual",
  salaryNote: null,
  weeklyHours: null,
  candidatesCount: 12,
  badges: [],
  jdText: `Buscamos AI Engineer con RAG y agentes (${externalId}). Remoto para Argentina y Chile.`,
  postedAt: new Date(),
  tags: ["Python"],
  seniority: "Senior",
  lang: "es",
});

const fakeEvaluation = {
  score: 8,
  confianza: "alta",
  years_required: 4,
  years_domain: "desarrollo de software",
  years_discipline: "ai_engineer",
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "startup",
  paises_permitidos: ["AR", "CL"],
  match_fuerte: ["RAG"],
  gaps: [],
  riesgos: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "Match alto.",
  accion_sugerida: "aplicar",
};

const spend = (userId: string, task: string, costUsd: number) =>
  conn.db.insert(s.llmCalls).values({
    userId,
    task,
    model: "modelo-ficticio",
    costUsd,
    ok: true,
    tokensIn: 1,
    tokensOut: 1,
  });

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 4 });
  for (const [userId, tag] of [
    [CV_USER, "cv"],
    [OTHER, "ot"],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: `Persona ${tag}`,
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: `u_${tag}_piso@ingest.test`,
        profileSummary: "AI Engineer con RAG y agentes.",
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId, version: 1, active: true, rules: criteria as never })
      .onConflictDoNothing();
  }
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls);
  await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
  // Otra persona dejó el total dentro de la parte reservada (USD 1,7 de 2); la de CV gastó USD 0,5 en CV
  await spend(OTHER, "evaluate_job", 1.7);
  await spend(CV_USER, "cv_write", 0.5);
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("piso de la parte reservada sin el gasto de CV", () => {
  it("reserva: quien solo gastó en CV sigue pudiendo usar la parte reservada", async () => {
    const r = await reserveLlmSpend(conn.db, {
      userId: CV_USER,
      estimateUsd: 0.1,
      dailyCapUsd: CAP,
      userDailyCapUsd: 0,
    });
    expect(r.ok).toBe(true);
  });

  it("reserva: quien gastó USD 0,5 en evaluaciones queda frenado", async () => {
    await spend(CV_USER, "evaluate_job", 0.5);
    const r = await reserveLlmSpend(conn.db, {
      userId: CV_USER,
      estimateUsd: 0.1,
      dailyCapUsd: CAP,
      userDailyCapUsd: 0,
    });
    expect(r).toEqual({ ok: false, reason: "global" });
  });

  it("cron: el dueño con gasto de CV se evalúa dentro de la parte reservada", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(raw("piso-1"), {
      db: conn.db,
      userId: CV_USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const res = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 5, dailyCapUsd: CAP, userDailyCapUsd: 0 },
    );
    expect(out.action).toBe("inserted");
    expect(res.evaluated).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });
});
