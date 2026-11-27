import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { err, jobCardHash } from "@job-search-os/pipeline";
import { eq, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzleCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import { DEMO_JOB_CARD_INJECT_MARK } from "../llm/demo-job-card";
import { LLM_RESERVE_TTL_MS } from "../llm/spend-reserve";
import type { LlmClient } from "../llm/types";
import { createLogger } from "../logger";
import { purgeOrphanJobCards } from "../retention/job-cards";
import { ensureJobCard, ensureJobCardBeforeEvaluation } from "./ensure";
import { fillMissingJdHash } from "./jd-hash";

/**
 * La ficha del aviso contra la base y el modelo simulado (R31-03): una sola vez por texto aunque lleguen pedidos
 * a la vez, sin texto no se llama al modelo, topes propios y global, reintento de las fallidas y nada que diga
 * quién la pidió. Avisos inventados.
 */
const NOW = new Date("2026-11-26T12:00:00Z");
const clock = () => NOW;
const logger = createLogger({ test: "job-card" }).child({});
logger.level = "silent";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const aviso = (n: number | string, extra = ""): string =>
  `Empresa A busca una persona para Atención al Cliente en su local del centro (${n}).
Vas a atender a las personas que llegan y registrar los pedidos en el sistema todos los días de la semana.

Qué vas a hacer
- Atender a las personas que llegan al local.
- Registrar los pedidos en el sistema.

Requisitos indispensables:
- Al menos 2 años de experiencia en atención al público.
- Manejo de Excel.
Deseable:
- Inglés intermedio.

Condiciones
Modalidad presencial.
Jornada completa, de lunes a viernes.
${extra}`;

type Mode = { fail?: boolean; throws?: boolean; delayMs?: number };

function makeLlm(mode: Mode = {}) {
  const inner = createDemoLlm({ calls: drizzleCallSink(conn.db) });
  let calls = 0;
  const llm: LlmClient = {
    async generateStructured(task, schema, vars, ctx) {
      calls++;
      if (mode.delayMs) await new Promise((r) => setTimeout(r, mode.delayMs));
      if (mode.throws) throw new Error("falla inesperada del cliente");
      if (mode.fail) return err({ kind: "generation_failed", task, detail: "falla simulada" });
      return inner.generateStructured(task, schema, vars, ctx);
    },
  };
  return { llm, count: () => calls };
}

const deps = (llm: LlmClient, reserve = {}) => ({
  db: conn.db,
  llm,
  logger,
  now: clock,
  reserve: { globalCapUsd: 0, ...reserve },
});

const rowOf = async (text: string) =>
  (
    await conn.db
      .select()
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(text)))
  )[0];

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
  conn = createDb(ownerUrl, { max: 12 });
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.jobCards);
  await conn.db
    .delete(s.llmCalls)
    .where(or(eq(s.llmCalls.task, "extract_job_card"), eq(s.llmCalls.task, "llm_reserve")));
});

afterAll(async () => {
  await conn?.db.delete(s.jobCards);
  await conn?.db
    .delete(s.llmCalls)
    .where(or(eq(s.llmCalls.task, "extract_job_card"), eq(s.llmCalls.task, "llm_reserve")));
  await conn?.close();
  await container?.stop();
});

describe("ensureJobCard: una sola vez por texto", () => {
  it("genera la ficha, la guarda verificada y registra la llamada sin persona", async () => {
    const text = aviso(1);
    const { llm, count } = makeLlm();
    expect(await ensureJobCard(deps(llm), { text })).toEqual({ status: "lista", generated: true });
    expect(count()).toBe(1);
    const row = await rowOf(text);
    expect(row).toMatchObject({
      status: "lista",
      attempts: 1,
      promptVersion: "extract_job_card@v1",
      model: "fake",
      jdLanguage: "es",
      modality: "presencial",
    });
    expect(JSON.stringify(row?.card)).toContain("Atender a las personas");

    const calls = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, "extract_job_card"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      userId: null,
      label: `job_card:${jobCardHash(text)}`,
      ok: true,
    });
    // La reserva se soltó
    const live = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.task, "llm_reserve"));
    expect(live).toEqual([]);
    // Nada en la ficha que diga quién la pidió
    expect(Object.keys(row ?? {}).filter((k) => /user|owner|request/i.test(k))).toEqual([]);
  });

  it("una segunda vez no llama al modelo: ya hay ficha", async () => {
    const text = aviso(2);
    const first = makeLlm();
    await ensureJobCard(deps(first.llm), { text });
    const second = makeLlm();
    expect(await ensureJobCard(deps(second.llm), { text })).toEqual({
      status: "lista",
      generated: false,
    });
    expect(second.count()).toBe(0);
  });

  it("ocho pedidos a la vez del mismo aviso: un solo llamado al modelo y una sola fila", async () => {
    const text = aviso(3);
    const { llm, count } = makeLlm({ delayMs: 150 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => ensureJobCard(deps(llm), { text })),
    );
    expect(count()).toBe(1);
    expect(results.filter((r) => r.status === "lista" && r.generated)).toHaveLength(1);
    // Los demás ven «preparando» (otro la genera) o, si llegaron después, la ficha ya lista
    expect(results.filter((r) => r.status === "preparando" || r.status === "lista")).toHaveLength(
      8,
    );
    const rows = await conn.db
      .select()
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(text)));
    expect(rows).toHaveLength(1);
  });

  it("avisos distintos a la vez no se bloquean entre sí", async () => {
    const { llm, count } = makeLlm({ delayMs: 50 });
    const results = await Promise.all(
      [10, 11, 12].map((n) => ensureJobCard(deps(llm), { text: aviso(n) })),
    );
    expect(results.every((r) => r.status === "lista")).toBe(true);
    expect(count()).toBe(3);
  });

  it("una reserva colgada deja de bloquear cuando vence", async () => {
    const text = aviso(4);
    await conn.db.insert(s.llmCalls).values({
      userId: null,
      task: "llm_reserve",
      model: "none",
      label: `job_card:${jobCardHash(text)}`,
      tokensOut: 70_000,
      ok: true,
      createdAt: new Date(NOW.getTime() - LLM_RESERVE_TTL_MS - 60_000),
    });
    const { llm, count } = makeLlm();
    expect(await ensureJobCard(deps(llm), { text })).toEqual({ status: "lista", generated: true });
    expect(count()).toBe(1);
  });

  it("con una reserva viva del mismo texto, responde «preparando» sin llamar al modelo", async () => {
    const text = aviso(5);
    await conn.db.insert(s.llmCalls).values({
      userId: null,
      task: "llm_reserve",
      model: "none",
      label: `job_card:${jobCardHash(text)}`,
      tokensOut: 70_000,
      ok: true,
      createdAt: new Date(NOW.getTime() - 1_000),
    });
    const { llm, count } = makeLlm();
    expect(await ensureJobCard(deps(llm), { text })).toEqual({ status: "preparando" });
    expect(count()).toBe(0);
  });
});

describe("ensureJobCard: sin texto suficiente", () => {
  it("no llama al modelo y no anota nada si no hay texto", async () => {
    const { llm, count } = makeLlm();
    expect(await ensureJobCard(deps(llm), { text: null })).toEqual({ status: "sin_texto" });
    expect(await ensureJobCard(deps(llm), { text: "   " })).toEqual({ status: "sin_texto" });
    expect(count()).toBe(0);
    expect(await conn.db.select().from(s.jobCards)).toEqual([]);
  });

  it("con un texto corto anota «sin_texto» una vez y no llama al modelo", async () => {
    const { llm, count } = makeLlm();
    await ensureJobCard(deps(llm), { text: "Se busca gente para trabajar." });
    await ensureJobCard(deps(llm), { text: "Se busca gente para trabajar." });
    expect(count()).toBe(0);
    const rows = await conn.db.select().from(s.jobCards);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "sin_texto", card: null });
  });
});

describe("ensureJobCard: topes", () => {
  it("el tope diario de fichas: la que excede queda en «tope» y no llama al modelo", async () => {
    const { llm, count } = makeLlm();
    const caps = { caps: { dailyMax: 2, dailyUsd: 10 } };
    expect((await ensureJobCard(deps(llm, caps), { text: aviso(20) })).status).toBe("lista");
    expect((await ensureJobCard(deps(llm, caps), { text: aviso(21) })).status).toBe("lista");
    expect(await ensureJobCard(deps(llm, caps), { text: aviso(22) })).toEqual({
      status: "tope",
      reason: "daily_count",
    });
    expect(count()).toBe(2);
    expect(await rowOf(aviso(22))).toBeUndefined();
  });

  it("el tope de gasto cuenta lo ya gastado en fichas", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: null,
      task: "extract_job_card",
      model: "modelo-ficticio",
      label: "job_card:previa",
      costUsd: 0.98,
      ok: true,
      createdAt: new Date(NOW.getTime() - 3_600_000),
    });
    const { llm, count } = makeLlm();
    expect(
      await ensureJobCard(deps(llm, { caps: { dailyMax: 50, dailyUsd: 1 } }), { text: aviso(23) }),
    ).toEqual({ status: "tope", reason: "daily_usd" });
    expect(count()).toBe(0);
  });

  it("las llamadas de hace más de 24 h no cuentan", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: null,
      task: "extract_job_card",
      model: "modelo-ficticio",
      label: "job_card:vieja",
      costUsd: 5,
      ok: true,
      createdAt: new Date(NOW.getTime() - 25 * 3_600_000),
    });
    const { llm } = makeLlm();
    expect(
      (await ensureJobCard(deps(llm, { caps: { dailyMax: 1, dailyUsd: 1 } }), { text: aviso(24) }))
        .status,
    ).toBe("lista");
  });

  it("el tope global de gasto de todos también frena", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: null,
      task: "evaluate_job",
      model: "modelo-ficticio",
      costUsd: 1.9,
      ok: true,
      createdAt: new Date(NOW.getTime() - 3_600_000),
    });
    const { llm, count } = makeLlm();
    expect(await ensureJobCard(deps(llm, { globalCapUsd: 2 }), { text: aviso(25) })).toEqual({
      status: "tope",
      reason: "global",
    });
    expect(count()).toBe(0);
    await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.task, "evaluate_job"));
  });
});

describe("ensureJobCard: fallas y reintento", () => {
  it("si el modelo falla queda «fallida» con un código, sin texto del aviso", async () => {
    const text = aviso(30);
    const { llm } = makeLlm({ fail: true });
    const r = await ensureJobCard(deps(llm), { text });
    expect(r).toEqual({ status: "fallida", errorCode: "llm_generation_failed" });
    const row = await rowOf(text);
    expect(row).toMatchObject({ status: "fallida", attempts: 1, card: null });
    expect(row?.errorCode).toBe("llm_generation_failed");
    expect(JSON.stringify(row)).not.toContain("Empresa A");
  });

  it("sin pedir reintento, una fallida no vuelve a llamar al modelo", async () => {
    const text = aviso(31);
    await ensureJobCard(deps(makeLlm({ fail: true }).llm), { text });
    const again = makeLlm();
    expect((await ensureJobCard(deps(again.llm), { text })).status).toBe("fallida");
    expect(again.count()).toBe(0);
  });

  it("con reintento, la fallida pasa a lista y suma el intento", async () => {
    const text = aviso(32);
    await ensureJobCard(deps(makeLlm({ fail: true }).llm), { text });
    const retry = makeLlm();
    expect(await ensureJobCard(deps(retry.llm), { text, retry: true })).toEqual({
      status: "lista",
      generated: true,
    });
    expect(retry.count()).toBe(1);
    expect(await rowOf(text)).toMatchObject({ status: "lista", attempts: 2, errorCode: null });
  });

  it("los reintentos tienen máximo", async () => {
    const text = aviso(33);
    const failing = makeLlm({ fail: true });
    for (let i = 0; i < 5; i++) await ensureJobCard(deps(failing.llm), { text, retry: true });
    expect(failing.count()).toBe(3);
    expect((await rowOf(text))?.attempts).toBe(3);
  });

  it("una ficha lista nunca se pisa, ni pidiendo reintento", async () => {
    const text = aviso(34);
    await ensureJobCard(deps(makeLlm().llm), { text });
    const again = makeLlm({ fail: true });
    expect((await ensureJobCard(deps(again.llm), { text, retry: true })).status).toBe("lista");
    expect(again.count()).toBe(0);
    expect((await rowOf(text))?.status).toBe("lista");
  });

  it("una excepción del cliente no se propaga y la reserva se suelta", async () => {
    const text = aviso(35);
    const { llm } = makeLlm({ throws: true });
    const r = await ensureJobCard(deps(llm), { text });
    expect(r).toEqual({ status: "fallida", errorCode: "error_interno" });
    const live = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.task, "llm_reserve"));
    expect(live).toEqual([]);
  });
});

describe("ensureJobCard: el modelo propone, el código decide", () => {
  it("un modelo que obedeció una instrucción del aviso no deja su veredicto en la ficha", async () => {
    const text = aviso(40, DEMO_JOB_CARD_INJECT_MARK);
    const { llm } = makeLlm();
    expect((await ensureJobCard(deps(llm), { text })).status).toBe("lista");
    const stored = JSON.stringify((await rowOf(text))?.card);
    expect(stored).not.toMatch(/coincide|puntaje|aplic/i);
    expect(stored).toContain("Atender a las personas");
  });
});

describe("ensureJobCardBeforeEvaluation", () => {
  const ALLOWED = "a3170000-0000-4000-8000-0000000000a1";
  const OTHER = "a3170000-0000-4000-8000-0000000000a2";
  const ENV = { JOB_CARD: "testers", ADMIN_EMAILS: "admin-ficha@example.com" };
  const jobOf = (
    userId: string,
    text: string | null,
    id = "a3170000-0000-4000-8000-0000000000b1",
    jdHash: string | null = null,
  ) => ({
    id,
    userId,
    jdText: text,
    jdHash,
  });

  beforeAll(async () => {
    await conn.db
      .insert(s.users)
      .values([
        { id: ALLOWED, email: "admin-ficha@example.com" },
        { id: OTHER, email: "otra-ficha@example.com" },
      ])
      .onConflictDoNothing();
  });

  it("con JOB_CARD apagada no hace nada (la evaluación corre como antes)", async () => {
    const { llm, count } = makeLlm();
    const job = jobOf(ALLOWED, aviso(50));
    expect(await ensureJobCardBeforeEvaluation(deps(llm), job, {})).toBeNull();
    expect(await ensureJobCardBeforeEvaluation(deps(llm), job, { JOB_CARD: "no" })).toBeNull();
    expect(count()).toBe(0);
    expect(await conn.db.select().from(s.jobCards)).toEqual([]);
  });

  it("con JOB_CARD encendida deja la ficha lista antes de evaluar", async () => {
    const { llm, count } = makeLlm();
    const r = await ensureJobCardBeforeEvaluation(deps(llm), jobOf(ALLOWED, aviso(51)), ENV);
    expect(r).toEqual({ status: "lista", generated: true });
    expect(count()).toBe(1);
  });

  it("con `testers` no se genera para la oferta de una cuenta que no está en la etapa (falla cerrado)", async () => {
    const { llm, count } = makeLlm();
    expect(await ensureJobCardBeforeEvaluation(deps(llm), jobOf(OTHER, aviso(53)), ENV)).toBeNull();
    // cuenta inexistente
    expect(
      await ensureJobCardBeforeEvaluation(
        deps(llm),
        jobOf("a3170000-0000-4000-8000-0000000000ff", aviso(53)),
        ENV,
      ),
    ).toBeNull();
    expect(count()).toBe(0);
    expect(await rowOf(aviso(53))).toBeUndefined();
    // con `all`, cualquiera
    expect(
      (await ensureJobCardBeforeEvaluation(deps(llm), jobOf(OTHER, aviso(53)), { JOB_CARD: "all" }))
        ?.status,
    ).toBe("lista");
  });

  it("una oferta vieja con jd_hash nulo lo recibe al pedir la ficha, para que la RLS la una", async () => {
    const text = aviso(54);
    const [job] = await conn.db
      .insert(s.jobs)
      .values({
        userId: ALLOWED,
        companyRaw: "Empresa A",
        title: "Oferta vieja",
        titleNormalized: "oferta vieja",
        jdText: text,
      })
      .returning({ id: s.jobs.id, jdHash: s.jobs.jdHash });
    expect(job?.jdHash).toBeNull();
    const { llm } = makeLlm();
    await ensureJobCardBeforeEvaluation(deps(llm), jobOf(ALLOWED, text, job!.id), ENV);
    const [after] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, job!.id));
    expect(after?.jdHash).toBe(jobCardHash(text));
    // y fillMissingJdHash no pisa uno que ya está, ni inventa para un texto corto
    await fillMissingJdHash(conn.db, job!.id, "otro texto muy distinto ".repeat(30));
    const [again] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, job!.id));
    expect(again?.jdHash).toBe(jobCardHash(text));
    expect(await fillMissingJdHash(conn.db, job!.id, "corto")).toBeNull();
    await conn.db.delete(s.jobs).where(eq(s.jobs.id, job!.id));
  });

  it("nunca lanza, ni con la base rota", async () => {
    const { llm } = makeLlm();
    const broken = {
      ...deps(llm),
      db: { transaction: () => Promise.reject(new Error("x")) } as never,
    };
    expect(
      await ensureJobCardBeforeEvaluation(broken, jobOf(ALLOWED, aviso(52)), { JOB_CARD: "all" }),
    ).toBeNull();
  });
});

describe("purgeOrphanJobCards", () => {
  it("borra las fichas cuyo texto ya no está en ninguna oferta ni en el pool, y respeta las recientes", async () => {
    const mine = aviso(70);
    const orphan = aviso(71);
    const fresh = aviso(72);
    const pooled = aviso(73);
    const old = new Date("2026-01-01T00:00:00Z");
    const [job] = await conn.db
      .insert(s.jobs)
      .values({
        userId: "a3170000-0000-4000-8000-0000000000a1",
        companyRaw: "Empresa A",
        title: "Oferta con ficha",
        titleNormalized: "oferta con ficha",
        jdText: mine,
        jdHash: jobCardHash(mine),
      })
      .returning({ id: s.jobs.id });
    await conn.db.insert(s.publicJobs).values({
      sourceKind: "remoteok",
      externalId: "purga-ficha-test",
      sourceName: "Remote OK",
      sourceUrl: "https://example.com/p",
      title: "Pool",
      titleNormalized: "pool",
      companyRaw: "Empresa B",
      companyNormalized: "empresa b",
      jdHash: jobCardHash(pooled),
      firstSeenAt: old,
      lastSeenAt: old,
    });
    for (const [text, at] of [
      [mine, old],
      [orphan, old],
      [pooled, old],
      [fresh, new Date()],
    ] as const) {
      await conn.db.insert(s.jobCards).values({
        jdHash: jobCardHash(text),
        status: "fallida",
        errorCode: "x",
        createdAt: at,
        updatedAt: at,
      });
    }
    expect(await purgeOrphanJobCards(conn.db)).toBe(1);
    expect(await rowOf(orphan)).toBeUndefined();
    for (const t of [mine, pooled, fresh]) expect(await rowOf(t)).toBeDefined();
    await conn.db.delete(s.jobs).where(eq(s.jobs.id, job!.id));
    await conn.db.delete(s.publicJobs).where(eq(s.publicJobs.externalId, "purga-ficha-test"));
  });
});

describe("la tabla no recuerda quién la pidió", () => {
  it("ni las filas de llm_calls de las fichas llevan persona", async () => {
    await ensureJobCard(deps(makeLlm().llm), { text: aviso(60) });
    const withUser = await conn.db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.llmCalls)
      .where(
        sql`${s.llmCalls.userId} is not null and (${s.llmCalls.task} = 'extract_job_card' or ${s.llmCalls.label} like 'job_card:%')`,
      );
    expect(withUser[0]?.n).toBe(0);
  });
});
