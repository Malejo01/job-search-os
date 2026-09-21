import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { and, eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFakeLlm } from "../llm/fake";
import { createPgQueue, enqueueEvaluationWith, EVALUATE_QUEUE } from "../queue/pg-queue";
import { ingestRawJob } from "../ingest/ingest-job";
import { rawJobFromManual, type RawJob } from "@job-search-os/pipeline";
import { evaluateJobById, evaluateJobNow, runEvaluateWorker } from "./evaluate-job";

/**
 * JS-013 · Cola con SKIP LOCKED + worker con FakeLlm (sin red). Postgres real:
 * DATABASE_URL en CI o Testcontainers local.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const raw = (over: Partial<RawJob> & { externalId: string }): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "GoB programming",
    externalId: over.externalId,
    url: `https://www.getonbrd.com/jobs/${over.externalId}`,
    rawRef: null,
  },
  title: "AI Engineer",
  companyRaw: "Acme",
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
  jdText:
    "Buscamos AI Engineer con RAG, agentes y MCP. Python y TypeScript. Remoto para Argentina y Chile.",
  postedAt: new Date(),
  tags: ["Python"],
  seniority: "Senior",
  lang: "es",
  ...over,
});

const fakeEvaluation = {
  score: 8,
  confianza: "alta",
  years_required: 4,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "intermedio",
  tipo_empresa: "startup",
  paises_permitidos: ["AR", "CL"],
  match_fuerte: ["RAG", "MCP"],
  gaps: [{ skill: "AWS", nivel: "must" }],
  riesgos: [],
  bloqueadores_duros: [],
  senales_positivas: ["pocos candidatos"],
  veredicto: "Match alto.",
  accion_sugerida: "aplicar",
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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_test@ingest.test",
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

describe("cola job_queue (SKIP LOCKED)", () => {
  it("enqueue → dequeue marca processing y otro dequeue no lo ve; ack lo cierra", async () => {
    const q = createPgQueue(conn.db);
    const id = await q.enqueue(EVALUATE_QUEUE, { jobId: "x-1" }, { userId: USER });
    const [m] = await q.dequeue<{ jobId: string }>(EVALUATE_QUEUE, 10);
    expect(m).toMatchObject({ id, payload: { jobId: "x-1" }, attempts: 1, userId: USER });
    expect(await q.dequeue(EVALUATE_QUEUE, 10)).toEqual([]);
    await q.ack(id);
    expect((await q.stats(EVALUATE_QUEUE)).done).toBeGreaterThanOrEqual(1);
  });

  it("fail reintenta con backoff hasta max_attempts y después queda failed", async () => {
    const q = createPgQueue(conn.db);
    const id = await q.enqueue(EVALUATE_QUEUE, { jobId: "x-2" }, { userId: USER, maxAttempts: 2 });
    await q.dequeue(EVALUATE_QUEUE, 10);
    expect(await q.fail(id, "boom", { retryInSeconds: 0 })).toBe("retry");
    const again = await q.dequeue<{ jobId: string }>(EVALUATE_QUEUE, 10);
    expect(again.map((m) => m.payload.jobId)).toContain("x-2");
    expect(await q.fail(id, "boom 2")).toBe("failed");
    const [row] = await conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.id, id));
    expect(row).toMatchObject({ status: "failed", attempts: 2, lastError: "boom 2" });
  });

  it("dos workers concurrentes no toman el mismo mensaje", async () => {
    const q = createPgQueue(conn.db);
    const ids = await Promise.all(
      [1, 2, 3, 4].map((i) => q.enqueue(EVALUATE_QUEUE, { jobId: `c-${i}` }, { userId: USER })),
    );
    const [a, b] = await Promise.all([q.dequeue(EVALUATE_QUEUE, 2), q.dequeue(EVALUATE_QUEUE, 2)]);
    const taken = [...a, ...b].map((m) => m.id);
    expect(new Set(taken).size).toBe(taken.length);
    expect(taken.length).toBe(4);
    for (const id of ids) await q.ack(id);
  });

  it("requeueStale devuelve a pending los processing colgados", async () => {
    const q = createPgQueue(conn.db);
    const id = await q.enqueue(EVALUATE_QUEUE, { jobId: "stale" }, { userId: USER });
    await q.dequeue(EVALUATE_QUEUE, 10);
    await conn.db
      .update(s.jobQueue)
      .set({ lockedAt: new Date(Date.now() - 3600_000) })
      .where(eq(s.jobQueue.id, id));
    expect(await q.requeueStale(EVALUATE_QUEUE, 600)).toBe(1);
    const [m] = await q.dequeue<{ jobId: string }>(EVALUATE_QUEUE, 10);
    expect(m?.payload.jobId).toBe("stale");
    await q.ack(id);
  });

  it("enqueueEvaluationWith es idempotente mientras haya un mensaje pendiente", async () => {
    const q = createPgQueue(conn.db);
    const enqueue = enqueueEvaluationWith(conn.db, q);
    await enqueue("11111111-1111-1111-1111-111111111111", USER);
    await enqueue("11111111-1111-1111-1111-111111111111", USER);
    const msgs = await q.dequeue<{ jobId: string }>(EVALUATE_QUEUE, 10);
    expect(
      msgs.filter((m) => m.payload.jobId === "11111111-1111-1111-1111-111111111111"),
    ).toHaveLength(1);
    for (const m of msgs) await q.ack(m.id);
  });
});

describe("worker de evaluación (FakeLlm)", () => {
  it("ingesta con JD → encola → worker evalúa, guarda evaluations y transiciona a evaluada", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(raw({ externalId: "gob-worker-1" }), {
      db: conn.db,
      userId: USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
    });
    expect(out).toMatchObject({ action: "inserted", status: "prefiltrada", enqueued: true });

    const llm = createFakeLlm({ evaluate_job: fakeEvaluation }, { model: "fake-gemini" });
    const summary = await runEvaluateWorker({ db: conn.db, llm, queue: q, logger }, { limit: 5 });
    expect(summary.evaluated).toBe(1);
    expect(llm.calls[0]?.ctx.promptVersion).toBe("evaluate_job@v1.3.1");
    expect(llm.calls[0]?.vars.job).toContain("RAG, agentes y MCP");

    const jobId = out.jobId;
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    expect(job?.status).toBe("evaluada");
    const [ev] = await conn.db.select().from(s.evaluations).where(eq(s.evaluations.jobId, jobId));
    expect(ev).toMatchObject({
      userId: USER,
      model: "fake-gemini",
      promptVersion: "evaluate_job@v1.3.1",
      score: 7, // 8 del modelo − 1 por gap must de cloud (decide)
      scoreModel: 8,
      accion: "aplicar",
      gaps: ["AWS (must)"],
      riesgos: [],
    });
    expect((await q.stats(EVALUATE_QUEUE)).pending ?? 0).toBe(0);
  });

  it("sin jd_text no evalúa (skipped) y con LLM caído reintenta", async () => {
    const q = createPgQueue(conn.db);
    const noJd = await ingestRawJob(
      raw({
        externalId: "gob-worker-2",
        jdText: null,
        title: "Backend Engineer",
        companyRaw: "Umbrella",
      }),
      {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      },
    );
    expect(noJd).toMatchObject({ action: "inserted", status: "pendiente_jd", enqueued: false });
    await q.enqueue(EVALUATE_QUEUE, { jobId: noJd.jobId }, { userId: USER });
    const skipped = await runEvaluateWorker(
      { db: conn.db, llm: createFakeLlm({ evaluate_job: fakeEvaluation }), queue: q, logger },
      { limit: 5 },
    );
    expect(skipped.skipped).toBe(1);

    const withJd = await ingestRawJob(
      raw({
        externalId: "gob-worker-3",
        title: "Agentic Engineer",
        companyRaw: "Globex",
        jdText:
          "Globex busca Agentic Engineer para orquestar agentes con tool calling y evals. TypeScript.",
      }),
      {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      },
    );
    const down = createFakeLlm(
      {},
      { failWith: { kind: "generation_failed", task: "evaluate_job", detail: "credits depleted" } },
    );
    const retried = await runEvaluateWorker(
      { db: conn.db, llm: down, queue: q, logger },
      { limit: 5 },
    );
    expect(retried.retried).toBe(1);
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, withJd.jobId));
    expect(job?.status).toBe("prefiltrada");
  });

  it("evaluateJobById aplica decide(): cap de título y riesgos del prefiltro", async () => {
    const q = createPgQueue(conn.db);
    const capped = await ingestRawJob(
      raw({
        externalId: "gob-worker-4",
        title: "Lead AI Engineer",
        companyRaw: "Initech",
        candidatesCount: 2,
        locationRaw: "LATAM (remote)",
        countriesAllowed: null,
        jdText:
          "Initech busca Lead AI Engineer para un equipo chico. RAG, MCP, Python. Remoto LATAM.",
      }),
      {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      },
    );
    expect(capped).toMatchObject({ status: "prefiltrada" });
    const llm = createFakeLlm({ evaluate_job: { ...fakeEvaluation, score: 9 } });
    const r = await evaluateJobById(capped.jobId, { db: conn.db, llm, queue: q, logger });
    // 9 del modelo → cap 5 por título (Lead, 2 candidatos) → −1 por gap must de cloud = 4 → descartar
    expect(r).toMatchObject({ ok: true, score: 4, accion: "descartar" });
    const [ev] = await conn.db
      .select()
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, capped.jobId));
    expect(ev?.scoreModel).toBe(9);
    expect(ev?.riesgos.some((x) => /riesgo/i.test(x))).toBe(true);
    for (const m of await q.dequeue(EVALUATE_QUEUE, 50)) await q.ack(m.id);
  });
});

describe("worker: guardarraíles de costo y cancelación", () => {
  it("release devuelve el mensaje a pending sin consumir el intento", async () => {
    const q = createPgQueue(conn.db);
    const id = await q.enqueue(
      EVALUATE_QUEUE,
      { jobId: "rel-1" },
      { userId: USER, maxAttempts: 1 },
    );
    await q.dequeue(EVALUATE_QUEUE, 10);
    await q.release(id, "worker frenado: cap");
    const [row] = await conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.id, id));
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: "worker frenado: cap" });
    const [again] = await q.dequeue<{ jobId: string }>(EVALUATE_QUEUE, 10);
    expect(again?.payload.jobId).toBe("rel-1");
    await q.ack(id);
  });

  it("con el gasto de 24 h por encima del tope no toma mensajes y lo dice", async () => {
    const q = createPgQueue(conn.db);
    const id = await q.enqueue(EVALUATE_QUEUE, { jobId: "cap-1" }, { userId: USER });
    await conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: "evaluate_job",
      model: "gemini-cap",
      promptVersion: "evaluate_job@v1",
      tokensIn: 1000,
      tokensOut: 2000,
      tokensReasoning: 1700,
      latencyMs: 1,
      costUsd: 5,
      ok: true,
    });
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 5, dailyCapUsd: 2 },
    );
    expect(summary).toMatchObject({ stopped: "cap", taken: 0, dailyCapUsd: 2 });
    expect(summary.spendUsd24h).toBeGreaterThanOrEqual(5);
    expect(llm.calls).toHaveLength(0);
    const [row] = await conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.id, id));
    expect(row?.status).toBe("pending");
    // Con tope 0 (desactivado) sí procesa
    const again = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 5, dailyCapUsd: 0 },
    );
    expect(again.stopped).toBeNull();
    await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.model, "gemini-cap"));
  });

  it("una señal en medio de la tanda devuelve lo no procesado a pending", async () => {
    const q = createPgQueue(conn.db);
    const jobs = await Promise.all(
      [1, 2, 3].map((i) =>
        ingestRawJob(
          raw({ externalId: `sig-${i}`, companyRaw: `Sig ${i}`, jdText: `JD ${i} RAG` }),
          {
            db: conn.db,
            userId: USER,
            rules: criteria as never,
            logger,
            enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
          },
        ),
      ),
    );
    expect(jobs.every((j) => j.action === "inserted")).toBe(true);
    const controller = new AbortController();
    const llm = createFakeLlm({
      evaluate_job: () => {
        controller.abort(new Error("SIGINT"));
        return fakeEvaluation;
      },
    });
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger, signal: controller.signal },
      { limit: 10, dailyCapUsd: 0 },
    );
    expect(summary.stopped).toBe("signal");
    expect(summary.evaluated).toBe(1);
    expect(llm.calls).toHaveLength(1);
    const stats = await q.stats(EVALUATE_QUEUE);
    expect(stats.processing ?? 0).toBe(0);
    expect(stats.pending ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("worker: jobs que ya no pueden evaluarse", () => {
  it("una oferta cerrada después de encolar se salta sin llamar al modelo", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(
      raw({ externalId: "closed-1", companyRaw: "Closed SA", jdText: "JD cerrada RAG agentes" }),
      {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      },
    );
    expect(out.action).toBe("inserted");
    await conn.db.update(s.jobs).set({ status: "cerrada" }).where(eq(s.jobs.id, out.jobId));
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const summary = await runEvaluateWorker(
      { db: conn.db, llm, queue: q, logger },
      { limit: 10, dailyCapUsd: 0 },
    );
    const mine = summary.outcomes.find((o) => o.jobId === out.jobId);
    expect(mine).toMatchObject({ ok: false, retry: "skipped" });
    expect(llm.calls.map((c) => c.ctx.jobId)).not.toContain(out.jobId);
  });
});

describe("riesgo de ubicación en TODOS los caminos de entrada (Empresa AB/Empresa O)", () => {
  // El modelo dice location_ok = ok y no lista riesgos: el riesgo tiene que venir del prefiltro
  const blindLlm = () =>
    createFakeLlm({
      evaluate_job: { ...fakeEvaluation, score: 8, location_ok: "ok", riesgos: [] },
    });
  const deps = (q: ReturnType<typeof createPgQueue>) => ({
    db: conn.db,
    userId: USER,
    rules: criteria as never,
    logger,
    enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
  });
  const riskOf = async (jobId: string, q: ReturnType<typeof createPgQueue>) => {
    const [job] = await conn.db
      .select({ flags: s.jobs.flags })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    const r = await evaluateJobById(jobId, { db: conn.db, llm: blindLlm(), queue: q, logger });
    const [ev] = await conn.db.select().from(s.evaluations).where(eq(s.evaluations.jobId, jobId));
    return { flags: job?.flags ?? [], result: r, riesgos: ev?.riesgos ?? [] };
  };

  it("camino 1: Get on Board con países listados sin Argentina", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(
      raw({
        externalId: "gob-loc-1",
        title: "Applied AI Engineer (US/BR/CA)",
        companyRaw: "Empresa Z",
        locationRaw: "Remote",
        countriesAllowed: ["US", "BR", "CA"],
        jdText: "AI Engineer remoto para US, Brasil y Canadá. RAG, agentes, Python, TypeScript.",
      }),
      deps(q),
    );
    const { flags, result, riesgos } = await riskOf(out.jobId, q);
    expect(flags).toContain("location_risk");
    expect(result).toMatchObject({ ok: true });
    expect(riesgos.some((x) => /ubicaci/i.test(x))).toBe(true);
    for (const m of await q.dequeue(EVALUATE_QUEUE, 50)) await q.ack(m.id);
  });

  it("camino 2: alta manual / MCP (rawJobFromManual) remoto con LATAM", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(
      rawJobFromManual({
        url: "https://www.linkedin.com/jobs/view/loc-2",
        title: "AI Engineer (LinkedIn)",
        company: "Empresa AB",
        locationRaw: "LATAM (remote)",
        modality: "remoto",
        jdText: "AI Engineer para LATAM remoto. RAG, agentes, Python, TypeScript, evals.",
      }),
      deps(q),
    );
    const { flags, riesgos } = await riskOf(out.jobId, q);
    expect(flags).toContain("location_risk");
    expect(riesgos.some((x) => /ubicaci/i.test(x))).toBe(true);
    for (const m of await q.dequeue(EVALUATE_QUEUE, 50)) await q.ack(m.id);
  });

  it("camino 3: pendiente de JD → JD pegada después: conserva el riesgo del prefiltro", async () => {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(
      rawJobFromManual({
        url: "https://www.linkedin.com/jobs/view/loc-3",
        title: "AI Engineer (alerta LinkedIn)",
        company: "Empresa O",
        locationRaw: "Remote",
        modality: "remoto",
        jdText: null,
      }),
      deps(q),
    );
    expect(out).toMatchObject({ status: "pendiente_jd" });
    // Lo que hace attachJd (apps/web/lib/pending-jd.ts): guarda la JD y encola; no vuelve a prefiltrar
    await conn.db
      .update(s.jobs)
      .set({ jdText: "AI Engineer remoto. RAG, agentes, MCP, Python. Sin país explícito." })
      .where(eq(s.jobs.id, out.jobId));
    await enqueueEvaluationWith(conn.db, q)(out.jobId, USER);
    const { flags, riesgos } = await riskOf(out.jobId, q);
    expect(flags).toContain("location_risk");
    expect(riesgos.some((x) => /ubicaci/i.test(x))).toBe(true);
    for (const m of await q.dequeue(EVALUATE_QUEUE, 50)) await q.ack(m.id);
  });
});

describe("ingesta: dedup no fusiona por empresa+título (ADR-013)", () => {
  const deps = () => ({ db: conn.db, userId: USER, rules: criteria as never, logger });

  it("dos avisos de la misma consultora con título que normaliza igual → dos jobs, JD intactos, el segundo marcado", async () => {
    const loyalty = await ingestRawJob(
      raw({
        externalId: "dq-loyalty",
        companyRaw: "Consultora Delta",
        title: "Senior Quality Engineering (Loyalty & Benefits, Manual/API Testing)",
        jdText:
          "QA manual y API para el módulo de Loyalty & Benefits de un banco. Postman, Xray, JIRA.",
      }),
      deps(),
    );
    const biometric = await ingestRawJob(
      raw({
        externalId: "dq-biometric",
        companyRaw: "Consultora Delta",
        title: "Senior Quality Engineering (Biometric)",
        jdText:
          "QA de la plataforma biométrica y onboarding digital de un banco: liveness, OCR de DNI, métricas FAR/FRR.",
      }),
      deps(),
    );
    expect(loyalty).toMatchObject({ action: "inserted", possibleDuplicateOf: null });
    // Con JD en los dos, el texto distinto desmiente al título: ni siquiera se marca
    expect(biometric).toMatchObject({ action: "inserted", possibleDuplicateOf: null });
    expect(biometric.jobId).not.toBe(loyalty.jobId);
    const [a] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, loyalty.jobId));
    expect(a?.jdText).toContain("Loyalty");
  });

  it("sin JD que desmienta, empresa+título parecido → insert con duplicate_of_id y flag posible_duplicado", async () => {
    const first = await ingestRawJob(
      raw({ externalId: "dq-alert", companyRaw: "Hooli", title: "Data Engineer", jdText: null }),
      deps(),
    );
    const second = await ingestRawJob(
      raw({
        externalId: "dq-manual",
        companyRaw: "Hooli",
        title: "Senior Data Engineer",
        jdText: "Hooli busca Data Engineer: pipelines en Spark y dbt sobre Snowflake.",
      }),
      deps(),
    );
    expect(second).toMatchObject({ action: "inserted", possibleDuplicateOf: first.jobId });
    const [row] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, second.jobId));
    expect(row?.duplicateOfId).toBe(first.jobId);
    expect(row?.flags).toContain("posible_duplicado");
  });

  it("mismo JD con otra URL y otro título → merge por jd_hash", async () => {
    const jd = "Aviso republicado: plataforma de pagos, TypeScript y Postgres. Remoto LATAM.";
    const first = await ingestRawJob(
      raw({
        externalId: "dq-hash-1",
        companyRaw: "Pagos SA",
        title: "Backend Engineer",
        jdText: jd,
      }),
      deps(),
    );
    const second = await ingestRawJob(
      raw({
        externalId: "dq-hash-2",
        companyRaw: "Pagos SA",
        title: "Software Engineer (Payments)",
        jdText: `  ${jd.toUpperCase()} `,
      }),
      deps(),
    );
    expect(second).toMatchObject({ action: "merged", jobId: first.jobId, reason: "jd_hash" });
  });
});

describe("ingesta: clave fuerte fuera de la ventana de 14 días", () => {
  it("la misma URL vista hace 30 días → merge, no insert (antes chocaba con jobs_user_url)", async () => {
    const deps = { db: conn.db, userId: USER, rules: criteria as never, logger };
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const first = await ingestRawJob(
      raw({
        externalId: "win-old-1",
        companyRaw: "Ventana SA",
        jdText: "JD vieja RAG",
        postedAt: old,
      }),
      deps,
    );
    expect(first.action).toBe("inserted");
    // Mismo aviso por otra vía (sin external_id de GoB), 30 días después
    const again = await ingestRawJob(
      raw({
        externalId: "win-old-1",
        companyRaw: "Ventana SA",
        jdText: "JD vieja RAG",
        postedAt: new Date(),
        source: {
          kind: "manual",
          name: "manual",
          externalId: null,
          url: "https://www.getonbrd.com/jobs/win-old-1",
          rawRef: null,
        },
      }),
      deps,
    );
    expect(again).toMatchObject({ action: "merged", jobId: first.jobId, reason: "url" });
    // Y por id de la fuente, también fuera de la ventana
    const byId = await ingestRawJob(
      raw({ externalId: "win-old-1", companyRaw: "Ventana SA", jdText: "JD vieja RAG" }),
      deps,
    );
    expect(byId).toMatchObject({ action: "merged", jobId: first.jobId });
  });
});

describe("evaluación inmediata al pegar JD (JS-027)", () => {
  /** Oferta con JD recién encolada, como la deja "pegar JD". */
  async function queued(externalId: string) {
    const q = createPgQueue(conn.db);
    const out = await ingestRawJob(
      raw({
        externalId,
        companyRaw: `Ahora ${externalId}`,
        jdText: `JD ${externalId}: agentes con RAG y MCP en TypeScript.`,
      }),
      {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: enqueueEvaluationWith(conn.db, q),
      },
    );
    expect(out).toMatchObject({ action: "inserted", enqueued: true });
    return { q, jobId: out.jobId };
  }
  async function messageOf(jobId: string) {
    const [row] = await conn.db
      .select({ status: s.jobQueue.status, attempts: s.jobQueue.attempts })
      .from(s.jobQueue)
      .where(
        and(eq(s.jobQueue.queue, EVALUATE_QUEUE), sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`),
      );
    return row;
  }

  it("reclama el mensaje de esa oferta, evalúa y lo cierra: el cron ya no lo ve", async () => {
    const { q, jobId } = await queued("now-1");
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const r = await evaluateJobNow(
      jobId,
      { db: conn.db, llm, queue: q, logger },
      { dailyCapUsd: 0 },
    );
    expect(r).toMatchObject({ ran: true, outcome: { ok: true, jobId } });
    expect(llm.calls).toHaveLength(1);
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    expect(job?.status).toBe("evaluada");
    expect(await messageOf(jobId)).toMatchObject({ status: "done" });
  });

  it("si el cron ya tomó el mensaje, no evalúa dos veces", async () => {
    const { q, jobId } = await queued("now-2");
    // Simula al cron con el mensaje en proceso
    await conn.db
      .update(s.jobQueue)
      .set({ status: "processing", lockedAt: new Date() })
      .where(sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`);
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const r = await evaluateJobNow(
      jobId,
      { db: conn.db, llm, queue: q, logger },
      { dailyCapUsd: 0 },
    );
    expect(r).toEqual({ ran: false, reason: "not_pending" });
    expect(llm.calls).toHaveLength(0);
    await conn.db
      .update(s.jobQueue)
      .set({ status: "done" })
      .where(sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`);
  });

  it("con el tope de gasto superado no llama al modelo y deja el mensaje para el cron", async () => {
    const { q, jobId } = await queued("now-3");
    await conn.db.insert(s.llmCalls).values({
      userId: USER,
      task: "evaluate_job",
      model: "gemini-now-cap",
      promptVersion: "evaluate_job@v1",
      tokensIn: 1000,
      tokensOut: 2000,
      tokensReasoning: 0,
      latencyMs: 1,
      costUsd: 5,
      ok: true,
    });
    const llm = createFakeLlm({ evaluate_job: fakeEvaluation });
    const r = await evaluateJobNow(
      jobId,
      { db: conn.db, llm, queue: q, logger },
      { dailyCapUsd: 2 },
    );
    expect(r).toEqual({ ran: false, reason: "cap" });
    expect(llm.calls).toHaveLength(0);
    expect(await messageOf(jobId)).toMatchObject({ status: "pending", attempts: 0 });
    await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.model, "gemini-now-cap"));
    await conn.db
      .update(s.jobQueue)
      .set({ status: "done" })
      .where(sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`);
  });

  it("si el modelo falla, el mensaje vuelve a la cola para que el cron reintente", async () => {
    const { q, jobId } = await queued("now-4");
    const down = createFakeLlm(
      {},
      { failWith: { kind: "generation_failed", task: "evaluate_job", detail: "503" } },
    );
    const r = await evaluateJobNow(
      jobId,
      { db: conn.db, llm: down, queue: q, logger },
      { dailyCapUsd: 0 },
    );
    expect(r).toMatchObject({ ran: true, outcome: { ok: false, retry: "retry" } });
    expect(await messageOf(jobId)).toMatchObject({ status: "pending", attempts: 1 });
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, jobId));
    expect(job?.status).toBe("prefiltrada");
    await conn.db
      .update(s.jobQueue)
      .set({ status: "done" })
      .where(sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`);
  });
});
