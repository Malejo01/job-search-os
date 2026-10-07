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
import { spendCapReason, spendSince } from "../llm/spend";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { evaluateJobNow, runEvaluateWorker, USER_CAP_MESSAGE } from "./evaluate-job";

/**
 * JS-093 · Tope de costo LLM por usuario. Dos usuarios; uno pasó su tope de 24 h: sus mensajes
 * vuelven a pending y los del otro se evalúan. Cliente falso: cero llamadas pagas.
 */
const A = "a3000000-0000-4000-8000-000000000001"; // pasó su tope
const B = "b4000000-0000-4000-8000-000000000002";
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

async function enqueueJobFor(userId: string, externalId: string) {
  const q = createPgQueue(conn.db);
  const out = await ingestRawJob(raw(externalId), {
    db: conn.db,
    userId,
    rules: criteria as never,
    logger,
    enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
  });
  expect(out.action).toBe("inserted");
  return out.jobId;
}

const queueRow = async (jobId: string) => {
  const rows = await conn.db.select().from(s.jobQueue);
  return rows.find((r) => (r.payload as { jobId?: string }).jobId === jobId);
};

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
  await seedUser(A, "a");
  await seedUser(B, "b");
  // A ya gastó USD 5 en 24 h (tope por usuario de la prueba: 1); B no gastó nada
  await conn.db.insert(s.llmCalls).values({
    userId: A,
    task: "evaluate_job",
    model: "modelo-falso",
    tokensIn: 1000,
    tokensOut: 2000,
    costUsd: 5,
    ok: true,
  });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("tope diario por usuario (JS-093)", () => {
  it("spendSince con userId suma solo las llamadas de ese usuario", async () => {
    const since = new Date(Date.now() - 24 * 3600_000);
    expect((await spendSince(conn.db, since, { userId: A })).usd).toBe(5);
    expect((await spendSince(conn.db, since, { userId: B })).usd).toBe(0);
    expect((await spendSince(conn.db, since)).usd).toBe(5);
  });

  it("spendCapReason distingue tope global, del usuario y sin tope (borradores, evaluación inmediata)", async () => {
    const off = { dailyCapUsd: 0, userDailyCapUsd: 0 };
    expect(await spendCapReason(conn.db, { userId: A, ...off })).toBeNull();
    expect(await spendCapReason(conn.db, { userId: A, ...off, userDailyCapUsd: 1 })).toBe("user");
    expect(await spendCapReason(conn.db, { userId: B, ...off, userDailyCapUsd: 1 })).toBeNull();
    // El gasto de A cuenta para el tope global de todos
    expect(await spendCapReason(conn.db, { userId: B, dailyCapUsd: 3, userDailyCapUsd: 1 })).toBe(
      "global",
    );
  });

  it("el worker deja pending los mensajes del usuario sobre su tope y evalúa los de otro", async () => {
    const q = createPgQueue(conn.db);
    const jobA1 = await enqueueJobFor(A, "uc-a1");
    const jobB1 = await enqueueJobFor(B, "uc-b1");
    const jobA2 = await enqueueJobFor(A, "uc-a2");
    const jobB2 = await enqueueJobFor(B, "uc-b2");
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });

    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 1 },
    );

    expect(summary.stopped).toBeNull();
    expect(summary.userCapped).toBe(2);
    expect(summary.evaluated).toBe(2);
    expect(llm.calls.map((c) => c.ctx.userId)).toEqual([B, B]);
    for (const id of [jobA1, jobA2]) {
      expect(await queueRow(id)).toMatchObject({ status: "pending", attempts: 0 });
      expect((await queueRow(id))?.lastError).toBe(USER_CAP_MESSAGE);
    }
    for (const id of [jobB1, jobB2]) {
      expect((await queueRow(id))?.status).toBe("done");
    }
    const [evaluatedA] = await conn.db
      .select({ status: s.jobs.status })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobA1));
    expect(evaluatedA?.status).not.toBe("evaluada");
  });

  it("con tope 0 (desactivado) el usuario sobre su tope sí se evalúa", async () => {
    const q = createPgQueue(conn.db);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    // Los de A quedaron pospuestos 1 h por el test anterior: se adelantan para esta corrida
    await conn.db.update(s.jobQueue).set({ runAfter: new Date() }).where(eq(s.jobQueue.userId, A));
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 10, dailyCapUsd: 0, userDailyCapUsd: 0 },
    );
    expect(summary.userCapped).toBe(0);
    expect(summary.evaluated).toBe(2);
    expect(llm.calls.map((c) => c.ctx.userId)).toEqual([A, A]);
  });

  it("25 mensajes de un usuario topeado + 1 de otro: el del otro se evalúa en la primera corrida", async () => {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
    const q = createPgQueue(conn.db);
    const jobsA: string[] = [];
    for (let i = 0; i < 25; i++) jobsA.push(await enqueueJobFor(A, `uc-lote-a${i}`));
    const jobB = await enqueueJobFor(B, "uc-lote-b");
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });

    const before = Date.now();
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 20, dailyCapUsd: 0, userDailyCapUsd: 1 },
    );

    expect(summary.evaluated).toBe(1);
    expect(llm.calls.map((c) => c.ctx.userId)).toEqual([B]);
    expect((await queueRow(jobB))?.status).toBe("done");
    for (const id of jobsA) {
      const row = await queueRow(id);
      expect(row?.status).toBe("pending");
      // pospuestos: no vuelven a ocupar el lote de la próxima corrida
      expect(row!.runAfter.getTime()).toBeGreaterThan(before + 30 * 60 * 1000);
    }
    const again = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 20, dailyCapUsd: 0, userDailyCapUsd: 1 },
    );
    expect(again.taken).toBe(0);
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
  });

  it("evaluateJobNow devuelve el error claro y no reclama el mensaje del usuario sobre su tope", async () => {
    const q = createPgQueue(conn.db);
    const jobA = await enqueueJobFor(A, "uc-a3");
    const jobB = await enqueueJobFor(B, "uc-b3");
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const deps = { db: conn.db, llm, queue: q, logger };
    const opts = { dailyCapUsd: 0, userDailyCapUsd: 1 };

    const blocked = await evaluateJobNow(jobA, deps, opts);
    expect(blocked).toEqual({ ran: false, reason: "user_cap", message: USER_CAP_MESSAGE });
    expect((await queueRow(jobA))?.status).toBe("pending");
    expect(llm.calls).toHaveLength(0);

    const ok = await evaluateJobNow(jobB, deps, opts);
    expect(ok).toMatchObject({ ran: true, outcome: { ok: true } });
    expect(llm.calls).toHaveLength(1);

    // Limpieza de lo pendiente de A para no afectar otros tests del archivo
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.queue, EVALUATE_QUEUE));
  });
});
