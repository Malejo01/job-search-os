import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeLlm } from "../llm/fake";
import { ingestRawJob } from "../ingest/ingest-job";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { runEvaluateWorker } from "./evaluate-job";
import { evaluateStatus, readStatusSnapshot } from "./status";

/**
 * Ronda 69 · I-5 (presupuesto de tiempo del worker) e I-6 (consulta de /api/cron/status).
 * Reloj inyectado y cliente falso: no duerme de verdad ni llama a ningún modelo.
 */
const USER = "c5000000-0000-4000-8000-000000000001";
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

async function enqueueJobs(prefix: string, n: number) {
  const q = createPgQueue(conn.db);
  for (let i = 0; i < n; i++) {
    const out = await ingestRawJob(raw(`${prefix}-${i}`), {
      db: conn.db,
      userId: USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    expect(out.action).toBe("inserted");
  }
  return q;
}

const queueCount = async (status: string) =>
  (await conn.db.select().from(s.jobQueue)).filter(
    (r) => r.queue === EVALUATE_QUEUE && r.status === status,
  ).length;

/** LLM falso que hace avanzar el reloj `ms` por cada evaluación. */
function slowLlm(clock: { t: number }, ms: number) {
  return createFakeLlm({
    evaluate_job: () => {
      clock.t += ms;
      return fakeEvaluation;
    },
  });
}

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Persona A",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_budget@ingest.test",
      profileSummary: "AI Engineer con RAG y agentes.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("presupuesto de tiempo del worker (I-5)", () => {
  it("con presupuesto chico corta antes de terminar y deja lo pendiente en la cola", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = await enqueueJobs("bud-small", 5);
    // un pendiente diferido al futuro no cuenta como elegible en `remaining`
    await conn.db.insert(s.jobQueue).values({
      queue: EVALUATE_QUEUE,
      payload: { jobId: "diferido" },
      status: "pending",
      runAfter: new Date(Date.now() + 3_600_000),
    });
    const base = Date.now();
    const clock = { t: 0 };
    const llm = slowLlm(clock, 100_000);

    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger, now: () => new Date(base + clock.t) },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 0, budgetMs: 240_000 },
    );

    // t=0: 0+30 s <= 240 s evalúa (100 s). t=100: 100+100 <= 240 evalúa. t=200: 200+100 > 240 corta
    expect(summary.stopped).toBe("budget");
    expect(summary.evaluated).toBe(2);
    expect(llm.calls).toHaveLength(2);
    expect(summary.taken).toBe(2);
    expect(summary.remaining).toBe(3);
    // lo no procesado sigue pending (más el diferido), sin intento gastado y sin lock
    expect(await queueCount("pending")).toBe(4);
    expect(await queueCount("processing")).toBe(0);
    const pending = (await conn.db.select().from(s.jobQueue)).filter((r) => r.status === "pending");
    for (const r of pending) {
      expect(r.attempts).toBe(0);
      expect(r.lockedAt).toBeNull();
    }
  });

  it("la corrida siguiente retoma lo que quedó", async () => {
    const q = createPgQueue(conn.db);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 0, budgetMs: 240_000 },
    );
    expect(summary.stopped).toBeNull();
    expect(summary.evaluated).toBe(3);
    expect(summary.remaining).toBe(0);
    // solo queda el diferido, que todavía no es elegible
    expect(await queueCount("pending")).toBe(1);
  });

  it("con presupuesto grande procesa todo", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = await enqueueJobs("bud-big", 4);
    const base = Date.now();
    const clock = { t: 0 };
    const llm = slowLlm(clock, 1_000);

    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger, now: () => new Date(base + clock.t) },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 0, budgetMs: 240_000 },
    );

    expect(summary.stopped).toBeNull();
    expect(summary.evaluated).toBe(4);
    expect(summary.remaining).toBe(0);
    expect(await queueCount("pending")).toBe(0);
  });
});

describe("consulta de estado (I-6)", () => {
  it("lee solo agregados y los umbrales se evalúan sobre ellos", async () => {
    const now = new Date();
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    await conn.db.insert(s.publicJobs).values({
      sourceKind: "getonboard_api",
      externalId: "st-1",
      sourceName: "Fuente A",
      sourceUrl: "https://example.test/jobs/st-1",
      title: "Puesto A",
      titleNormalized: "puesto a",
      companyRaw: "Empresa A",
      companyNormalized: "empresa a",
      firstSeenAt: ago(50),
      lastSeenAt: ago(2),
    });
    // Tres descargas seguidas en error para una fuente; una ok para otra
    for (const h of [1, 7, 13]) {
      await conn.db.insert(s.publicJobFetches).values({
        sourceKind: "getonboard_api",
        startedAt: ago(h),
        status: "error",
        errorCode: "timeout",
      });
    }
    await conn.db.insert(s.publicJobFetches).values({
      sourceKind: "remoteok",
      startedAt: ago(1),
      status: "ok",
      fetched: 10,
      inserted: 3,
    });
    // Un pendiente elegible hace 30 h, uno diferido al futuro (no cuenta para la antigüedad) y uno fallido
    await conn.db.insert(s.jobQueue).values([
      { queue: EVALUATE_QUEUE, payload: { jobId: "x" }, status: "pending", runAfter: ago(30) },
      {
        queue: EVALUATE_QUEUE,
        payload: { jobId: "y" },
        status: "pending",
        runAfter: new Date(now.getTime() + 3_600_000),
      },
      { queue: EVALUATE_QUEUE, payload: { jobId: "z" }, status: "failed" },
    ]);

    const snap = await readStatusSnapshot(conn.db, now);
    expect(snap.poolLastSeenAt?.getTime()).toBe(ago(2).getTime());
    expect(snap.queue.pending).toBe(2);
    expect(snap.queue.failed24h).toBe(1);
    expect(snap.queue.oldestPendingMinutes).toBeCloseTo(30 * 60, 0);
    const gob = snap.sources.find((x) => x.source === "getonboard_api");
    expect(gob?.recent.map((f) => f.status)).toEqual(["error", "error", "error"]);
    expect(snap.sources.find((x) => x.source === "remoteok")?.recent).toHaveLength(1);

    const report = evaluateStatus(snap, now);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual([
      "queue_oldest_pending_hours",
      "source_consecutive_errors:getonboard_api",
    ]);
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
  });
});
