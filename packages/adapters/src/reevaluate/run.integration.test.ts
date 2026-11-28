import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { err, type RawJob } from "@job-search-os/pipeline";
import { desc, eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { drizzleCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import type { LlmClient } from "../llm/types";
import { createPgQueue, enqueueEvaluationWith } from "../queue/pg-queue";
import { evaluateJobById } from "../worker/evaluate-job";
import { memoryReevalStore, rollbackReevaluation, runReevaluation } from "./run";

/**
 * R31-09 · Reevaluación única, contra una base de test y el modelo simulado (USD 0). Prueba: dry-run por defecto
 * (sin llamar a nadie ni escribir), tope obligatorio, corte y retoma, evaluación anterior guardada y vuelta atrás.
 * Datos inventados.
 */
const USER = "a3109000-0000-4000-8000-000000000001";
const OLD = "evaluate_job@v1.3.3";
const NEW = "evaluate_job@v1.3.4";
const logger = pino({ level: "silent" });

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let jobIds: string[] = [];

const JDS = [
  ["AI Engineer", "Empresa A", "RAG, agentes y MCP con Python"],
  ["Agent Engineer", "Empresa B", "evals de agentes con TypeScript y Node"],
  ["LLM Engineer", "Empresa C", "pipelines de embeddings y búsqueda vectorial en Python"],
  ["Prompt Engineer", "Empresa D", "diseño de prompts, herramientas y MCP con TypeScript"],
] as const;

const raw = (i: number): RawJob => ({
  source: {
    kind: "getonboard_api",
    name: "GoB programming",
    externalId: `reeval-${i}`,
    url: `https://www.getonbrd.com/jobs/reeval-${i}`,
    rawRef: null,
  },
  title: JDS[i]![0],
  companyRaw: JDS[i]![1],
  locationRaw: "Remoto (Argentina)",
  countriesAllowed: ["AR"],
  modality: "remoto",
  contractType: "Full time",
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
  weeklyHours: null,
  candidatesCount: null,
  badges: [],
  jdText: `${JDS[i]![1]} busca ${JDS[i]![0]} para trabajar con ${JDS[i]![2]}. Remoto para Argentina. Vas a diseñar, probar y mantener sistemas con modelos de lenguaje, trabajar con el equipo de producto y medir la calidad de cada entrega semana a semana.`,
  postedAt: new Date(),
  tags: [],
  seniority: null,
  lang: "es",
});

type Mode = { costUsd?: number; failJobText?: string };
function makeLlm(mode: Mode = {}) {
  const inner = createDemoLlm({ calls: drizzleCallSink(conn.db) });
  let calls = 0;
  const llm: LlmClient = {
    async generateStructured(task, schema, vars, ctx) {
      calls++;
      if (mode.failJobText && String(vars.job ?? "").includes(mode.failJobText)) {
        return err({ kind: "generation_failed", task, detail: "falla simulada" });
      }
      const r = await inner.generateStructured(task, schema, vars, ctx);
      return r.ok && mode.costUsd !== undefined
        ? { ...r, value: { ...r.value, costUsd: mode.costUsd } }
        : r;
    },
  };
  return { llm, count: () => calls };
}

const latestOf = async (jobId: string) =>
  (
    await conn.db
      .select()
      .from(s.evaluations)
      .where(eq(s.evaluations.jobId, jobId))
      .orderBy(desc(s.evaluations.createdAt))
      .limit(1)
  )[0];
const evalCount = async () =>
  (await conn.db.select().from(s.evaluations).where(eq(s.evaluations.userId, USER))).length;

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
      displayName: "Prueba",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_reeval@ingest.test",
      profileSummary: "Ingeniería de IA.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
  await conn.db
    .insert(s.modelRouting)
    .values({
      task: "evaluate_job",
      provider: "anthropic",
      model: "modelo-ficticio",
      temperature: 0,
      maxTokens: 2048,
      inputUsdPerMtok: 2,
      outputUsdPerMtok: 10,
    })
    .onConflictDoUpdate({
      target: s.modelRouting.task,
      set: { inputUsdPerMtok: 2, outputUsdPerMtok: 10 },
    });

  // Cuatro ofertas evaluadas con la versión vieja
  const queue = createPgQueue(conn.db);
  const demo = createDemoLlm({ calls: drizzleCallSink(conn.db) });
  for (let i = 0; i < JDS.length; i++) {
    const out = await ingestRawJob(raw(i), {
      db: conn.db,
      userId: USER,
      rules: criteria as never,
      logger,
      enqueueEvaluation: enqueueEvaluationWith(conn.db, queue),
    });
    if (out.action !== "inserted") throw new Error(`no se insertó ${i}: ${out.action}`);
    jobIds.push(out.jobId);
    const ev = await evaluateJobById(out.jobId, {
      db: conn.db,
      llm: demo,
      queue,
      logger,
      promptVersion: OLD,
    });
    if (!ev.ok) throw new Error(`no evaluó ${i}: ${ev.error}`);
  }
  jobIds = [...jobIds].sort();
}, 240_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

const deps = (llm: LlmClient, store = memoryReevalStore()) => ({
  db: conn.db,
  llm,
  logger,
  store,
});

describe("reevaluación: dry-run por defecto", () => {
  it("cuenta, estima y no llama a nadie ni escribe nada", async () => {
    const { llm, count } = makeLlm();
    const store = memoryReevalStore();
    const before = await evalCount();
    const r = await runReevaluation(deps(llm, store), { promptVersion: NEW, execute: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      mode: "dry-run",
      counts: { todo: 4, upToDate: 0, alreadyDone: 0, notEligible: 0, deferred: 0 },
      maxUsd: null,
      evaluated: 0,
    });
    expect(r.value.perCallUsd).toBeCloseTo(0.012, 6);
    expect(r.value.estimatedUsd).toBeCloseTo(0.048, 6);
    expect(count()).toBe(0);
    expect(store.saves()).toBe(0);
    expect(await evalCount()).toBe(before);
  });

  it("con un tope informado dice si alcanza", async () => {
    const { llm } = makeLlm();
    const small = await runReevaluation(deps(llm), {
      promptVersion: NEW,
      execute: false,
      maxUsd: 0.01,
    });
    const big = await runReevaluation(deps(llm), {
      promptVersion: NEW,
      execute: false,
      maxUsd: 1,
    });
    expect(small.ok && small.value.fitsInCap).toBe(false);
    expect(big.ok && big.value.fitsInCap).toBe(true);
  });

  it("el límite (--limit) deja el resto para otra tanda", async () => {
    const { llm } = makeLlm();
    const r = await runReevaluation(deps(llm), { promptVersion: NEW, execute: false, limit: 3 });
    expect(r.ok && r.value.counts).toMatchObject({ todo: 3, deferred: 1 });
  });
});

describe("reevaluación: ejecutar", () => {
  it("sin tope de gasto no corre", async () => {
    const { llm, count } = makeLlm();
    const before = await evalCount();
    const r = await runReevaluation(deps(llm), { promptVersion: NEW, execute: true });
    expect(r).toEqual({ ok: false, error: { kind: "max_usd_obligatorio" } });
    expect(count()).toBe(0);
    expect(await evalCount()).toBe(before);
  });

  it("se frena al llegar al tope, guarda la evaluación anterior de cada oferta y se retoma", async () => {
    const store = memoryReevalStore();
    const before = await evalCount();
    const first = makeLlm({ costUsd: 0.4 });
    const r1 = await runReevaluation(deps(first.llm, store), {
      promptVersion: NEW,
      execute: true,
      maxUsd: 1,
    });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    // 0,4 + 0,4 + 0,4 (la tercera entra: 0,8 + estimado 0,012 <= 1); la cuarta no: 1,2 > 1
    expect(r1.value).toMatchObject({ evaluated: 3, failed: 0, stopped: "cap", remaining: 1 });
    expect(r1.value.spentUsd).toBeCloseTo(1.2, 6);
    expect(first.count()).toBe(3);
    expect(await evalCount()).toBe(before + 3);

    const state = store.current()!;
    const done = Object.entries(state.entries).filter(([, e]) => e.state === "done");
    expect(done).toHaveLength(3);
    for (const [jobId, entry] of done) {
      // La anterior sigue en la base y es la que el estado anotó
      expect(entry.previous.promptVersion).toBe(OLD);
      const prev = await conn.db
        .select()
        .from(s.evaluations)
        .where(eq(s.evaluations.id, entry.previous.evaluationId));
      expect(prev).toHaveLength(1);
      // La última de la oferta es la nueva
      expect((await latestOf(jobId))?.id).toBe(entry.next?.evaluationId);
      expect((await latestOf(jobId))?.promptVersion).toBe(NEW);
      expect(entry.job.status).toBe("evaluada");
    }

    // Retomar con el mismo comando: solo la que falta
    const second = makeLlm({ costUsd: 0.4 });
    const r2 = await runReevaluation(deps(second.llm, store), {
      promptVersion: NEW,
      execute: true,
      maxUsd: 5,
    });
    expect(r2.ok && r2.value).toMatchObject({ evaluated: 1, stopped: null, remaining: 0 });
    expect(second.count()).toBe(1);
    expect(store.current()!.spentUsd).toBeCloseTo(1.6, 6);

    // Y una tercera vez ya no hay nada
    const third = makeLlm();
    const r3 = await runReevaluation(deps(third.llm, store), {
      promptVersion: NEW,
      execute: true,
      maxUsd: 5,
    });
    expect(r3.ok && r3.value.counts.todo).toBe(0);
    expect(third.count()).toBe(0);
  });

  it("un estado de otra versión no se mezcla", async () => {
    const store = memoryReevalStore({
      version: 1,
      runId: "x",
      promptVersion: "evaluate_job@v9",
      startedAt: new Date().toISOString(),
      maxUsd: 1,
      spentUsd: 0,
      entries: {},
    });
    const r = await runReevaluation(deps(makeLlm().llm, store), {
      promptVersion: NEW,
      execute: false,
    });
    expect(r).toEqual({
      ok: false,
      error: { kind: "estado_de_otra_version", stateVersion: "evaluate_job@v9" },
    });
  });
});

describe("reevaluación: volver atrás", () => {
  it("dry-run no cambia nada; ejecutar borra las nuevas y la anterior vuelve a ser la última", async () => {
    const { rollbackStore, doneIds } = await freshRunOverOldOnes();
    const dry = await rollbackReevaluation(
      { db: conn.db, store: rollbackStore, logger },
      { execute: false },
    );
    expect(dry.ok && dry.value).toMatchObject({
      mode: "dry-run",
      restorable: doneIds.length,
      restored: 0,
    });
    for (const id of doneIds) expect((await latestOf(id))?.promptVersion).toBe(NEW);

    const run = await rollbackReevaluation(
      { db: conn.db, store: rollbackStore, logger },
      { execute: true },
    );
    expect(run.ok && run.value).toMatchObject({ restored: doneIds.length, kept: [] });
    for (const id of doneIds) {
      expect((await latestOf(id))?.promptVersion).toBe(OLD);
      const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id));
      expect(job?.status).toBe("evaluada");
    }
    expect(
      Object.values(rollbackStore.current()!.entries).every((e) => e.state === "rolled_back"),
    ).toBe(true);
  });

  it("no borra una evaluación nueva sobre la que la persona ya opinó", async () => {
    const { rollbackStore, doneIds } = await freshRunOverOldOnes();
    const withOpinion = doneIds[0]!;
    const newest = await latestOf(withOpinion);
    await conn.db
      .update(s.evaluations)
      .set({ humanVerdict: "de_acuerdo", humanVerdictAt: new Date() })
      .where(eq(s.evaluations.id, newest!.id));
    const run = await rollbackReevaluation(
      { db: conn.db, store: rollbackStore, logger },
      { execute: true },
    );
    expect(run.ok && run.value.kept).toEqual([{ jobId: withOpinion, reason: "con_opinion" }]);
    expect((await latestOf(withOpinion))?.promptVersion).toBe(NEW);
    for (const id of doneIds.slice(1)) expect((await latestOf(id))?.promptVersion).toBe(OLD);
  });

  it("sin archivo de estado no hay nada que volver atrás", async () => {
    const r = await rollbackReevaluation(
      { db: conn.db, store: memoryReevalStore(), logger },
      { execute: true },
    );
    expect(r).toEqual({ ok: false, error: { kind: "sin_estado" } });
  });
});

describe("reevaluación: una falla no corta la corrida", () => {
  it("la oferta que falla queda «failed», las demás siguen y la próxima corrida la reintenta", async () => {
    // Deja todas con la versión vieja como última
    await restoreAllToOld();
    const store = memoryReevalStore();
    const target = "Empresa C busca LLM Engineer";
    const failing = makeLlm({ failJobText: target });
    const r1 = await runReevaluation(deps(failing.llm, store), {
      promptVersion: NEW,
      execute: true,
      maxUsd: 5,
    });
    expect(r1.ok && r1.value).toMatchObject({ evaluated: 3, failed: 1, stopped: null });
    const failed = Object.values(store.current()!.entries).filter((e) => e.state === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error?.length ?? 0).toBeLessThanOrEqual(120);

    const ok = makeLlm();
    const r2 = await runReevaluation(deps(ok.llm, store), {
      promptVersion: NEW,
      execute: true,
      maxUsd: 5,
    });
    expect(r2.ok && r2.value).toMatchObject({ evaluated: 1, failed: 0 });
    expect(ok.count()).toBe(1);
  });
});

/** Borra toda evaluación de la versión nueva: todas las ofertas vuelven a tener la vieja como última. */
async function restoreAllToOld(): Promise<void> {
  await conn.db.delete(s.evaluations).where(inArray(s.evaluations.jobId, jobIds));
  const queue = createPgQueue(conn.db);
  const demo = createDemoLlm({ calls: drizzleCallSink(conn.db) });
  for (const id of jobIds) {
    await conn.db.update(s.jobs).set({ status: "prefiltrada" }).where(eq(s.jobs.id, id));
    const ev = await evaluateJobById(id, {
      db: conn.db,
      llm: demo,
      queue,
      logger,
      promptVersion: OLD,
    });
    if (!ev.ok) throw new Error(`no re-evaluó la vieja: ${ev.error}`);
  }
}

async function freshRunOverOldOnes() {
  await restoreAllToOld();
  const rollbackStore = memoryReevalStore();
  const { llm } = makeLlm();
  const r = await runReevaluation(deps(llm, rollbackStore), {
    promptVersion: NEW,
    execute: true,
    maxUsd: 5,
  });
  if (!r.ok || r.value.evaluated !== 4) throw new Error("la corrida de preparación no hizo las 4");
  return { rollbackStore, doneIds: [...jobIds] };
}
