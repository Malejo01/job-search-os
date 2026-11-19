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
import { spendCapReason } from "../llm/spend";
import { reserveLlmSpend } from "../llm/spend-reserve";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";

/**
 * La parte reservada del tope global (últimos 20 %) la respetan el cron y el gasto de CV no se la come.
 * Postgres real, cliente falso, datos ficticios.
 */
const A = "c7000000-0000-4000-8000-000000000001";
const B = "c7000000-0000-4000-8000-000000000002";
const C = "c7000000-0000-4000-8000-000000000003";
const D = "c7000000-0000-4000-8000-000000000004";
const CAP = 2;

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

async function seedUser(userId: string, tag: string) {
  await conn.db
    .insert(s.profiles)
    .values({
      userId,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: `u_${tag}@ingest.test`,
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}

async function enqueueFor(userId: string, prefix: string, n: number) {
  const q = createPgQueue(conn.db);
  for (let i = 0; i < n; i++) {
    const out = await ingestRawJob(raw(`${prefix}-${i}`), {
      db: conn.db,
      userId,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    expect(out.action).toBe("inserted");
  }
  return q;
}

const spent = (userId: string, task: string, costUsd: number) =>
  conn.db.insert(s.llmCalls).values({
    userId,
    task,
    model: "modelo-ficticio",
    costUsd,
    ok: true,
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
  conn = createDb(ownerUrl, { max: 6 });
  for (const [id, tag] of [
    [A, "ra"],
    [B, "rb"],
    [C, "rc"],
  ] as const) {
    await seedUser(id, tag);
  }
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls);
  await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("el cron respeta la parte reservada del tope global", () => {
  it("dos cuentas por encima del piso no consumen la parte reservada; quien casi no gastó sigue", async () => {
    // 0,9 + 0,9 = 1,8 de 2,0: ya estamos en la parte reservada (desde 1,6) y las dos superan el piso (0,1)
    await spent(A, "evaluate_job", 0.9);
    await spent(B, "evaluate_job", 0.9);
    const q = await enqueueFor(A, "res-a", 3);
    await enqueueFor(B, "res-b", 3);
    await enqueueFor(C, "res-c", 2);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });

    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 20, dailyCapUsd: CAP, userDailyCapUsd: 0 },
    );

    // Solo C (sin gasto) se evalúa: 2 llamadas, ninguna de A ni de B
    expect(summary.evaluated).toBe(2);
    expect(llm.calls.map((c) => c.ctx.userId)).toEqual([C, C]);
    expect(summary.userCapped).toBe(6);
    const rows = (await conn.db.select().from(s.jobQueue)).filter(
      (r) => r.queue === EVALUATE_QUEUE && r.status === "pending",
    );
    // Los seis de A y B siguen pendientes, sin intento gastado
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(r.attempts).toBe(0);
  });
});

describe("el gasto de CV no se come la parte reservada", () => {
  it("con el presupuesto de CV al máximo, la evaluación de quien gastó poco sigue", async () => {
    // Gasto de CV de varias cuentas: 1,8 en total, pero con su presupuesto propio
    await spent(D, "cv_interview", 0.9);
    await spent(C, "cv_write", 0.9);
    // B gastó 0,1 en evaluaciones: sin el gasto de CV está lejos de la parte reservada
    await spent(B, "evaluate_job", 0.1);

    const r = await reserveLlmSpend(conn.db, {
      userId: B,
      estimateUsd: 0.01,
      dailyCapUsd: CAP,
      userDailyCapUsd: 0,
    });
    expect(r.ok).toBe(true);
    expect(await spendCapReason(conn.db, { userId: B, dailyCapUsd: CAP, userDailyCapUsd: 0 })).toBe(
      null,
    );
  });

  it("el gasto de evaluaciones sí lo cuenta: con 1,8 de evaluaciones la persona que gastó 0,1 se frena", async () => {
    await spent(A, "evaluate_job", 1.7);
    await spent(B, "evaluate_job", 0.1);

    const r = await reserveLlmSpend(conn.db, {
      userId: B,
      estimateUsd: 0.01,
      dailyCapUsd: CAP,
      userDailyCapUsd: 0,
    });
    expect(r).toEqual({ ok: false, reason: "global" });
  });
});
