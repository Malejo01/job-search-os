import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import {
  buildCvDocument,
  CV_TAILOR_MAX_PER_DAY,
  err,
  type CvSourceData,
} from "@job-search-os/pipeline";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzleCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import { DEMO_TAILOR_INVENTS_MARK } from "../llm/demo-cv-tailor";
import { LLM_RESERVE_TASK } from "../llm/spend";
import { LLM_RESERVE_TTL_MS } from "../llm/spend-reserve";
import type { LlmClient } from "../llm/types";
import { CV_TAILOR_LABEL_PREFIX, CV_TAILOR_TASK } from "./reserve";
import { tailorCv, type CvTailorDeps } from "./service";

/**
 * Versión adaptada contra la base: tope de 3 por día (también en paralelo), reservas que se sueltan en `finally`
 * y vencen, topes globales y por persona, y el recorrido con el modelo simulado. Sin gasto. Datos inventados.
 */
const USERS = Array.from({ length: 2 }, (_, i) => `a3200000-0000-4000-8000-00000000000${i + 1}`);
const [A, B] = USERS as [string, string];
const NOW = new Date();

const data: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  headline: "Analista de datos",
  summary: null,
  skills: [{ name: "SQL" }, { name: "Excel" }],
  languages: [],
  achievements: [],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: ["Armé reportes semanales en Excel", "Automaticé la carga de datos con SQL"],
    },
  ],
};
const cv = buildCvDocument(data, { lang: "es", includeEmail: true });
const job = { title: "Analista de datos", company: "Empresa B", description: "Pedimos SQL." };

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const failingLlm: LlmClient = {
  async generateStructured(task) {
    return err({ kind: "generation_failed", task, detail: "falla simulada" });
  },
};

function makeDeps(overrides: Partial<CvTailorDeps> = {}): CvTailorDeps {
  return {
    llm: createDemoLlm({ calls: drizzleCallSink(conn.db) }),
    reserveDb: conn.db,
    caps: { dailyCapUsd: 0, userDailyCapUsd: 0 },
    ...overrides,
  };
}

const run = (deps: CvTailorDeps, userId = A, description = job.description) =>
  tailorCv(deps, { userId, cv, job: { ...job, description } });

async function liveReservations(userId: string): Promise<number> {
  const rows = await conn.db
    .select({ id: s.llmCalls.id })
    .from(s.llmCalls)
    .where(and(eq(s.llmCalls.userId, userId), eq(s.llmCalls.task, LLM_RESERVE_TASK)));
  return rows.length;
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
  conn = createDb(ownerUrl, { max: 8 });
  await conn.db
    .insert(s.users)
    .values(USERS.map((id, i) => ({ id, email: `adaptado-${i}@example.com` })))
    .onConflictDoNothing();
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, USERS));
  await conn?.db.delete(s.users).where(inArray(s.users.id, USERS));
  await conn?.close();
  await container?.stop();
});

describe("tailorCv · recorrido y tope diario", () => {
  it("con el modelo simulado devuelve la versión verificada y la propuesta", async () => {
    const r = await run(makeDeps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe("fake");
    expect(r.value.verified.changed).toBe(true);
    expect(r.value.proposal.entries[0]?.ref).toBe("experience-0");
    expect(await liveReservations(A)).toBe(0);
  });

  it("deja pedir tres por día y frena el cuarto", async () => {
    expect(CV_TAILOR_MAX_PER_DAY).toBe(3);
    const deps = makeDeps();
    for (let i = 0; i < 3; i++) expect((await run(deps)).ok).toBe(true);
    expect(await run(deps)).toEqual({ ok: false, error: { kind: "daily_limit" } });
  });

  it("con pedidos en paralelo de la misma persona entran solo tres", async () => {
    const deps = makeDeps();
    const results = await Promise.all(Array.from({ length: 7 }, () => run(deps)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.error.kind === "daily_limit").length).toBe(4);
    expect(await liveReservations(A)).toBe(0);
  });

  it("el tope es por persona", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 3; i++) await run(deps);
    expect((await run(deps, B)).ok).toBe(true);
  });

  it("un pedido de hace más de un día no cuenta", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    for (let i = 0; i < 3; i++) {
      await conn.db.insert(s.llmCalls).values({
        userId: A,
        task: CV_TAILOR_TASK,
        model: "m",
        label: `${CV_TAILOR_LABEL_PREFIX}viejo-${i}`,
        costUsd: 0,
        ok: true,
        createdAt: old,
      });
    }
    expect((await run(makeDeps())).ok).toBe(true);
  });

  it("una versión que la verificación descarta también gasta cupo", async () => {
    const deps = makeDeps();
    for (let i = 0; i < 3; i++) {
      expect(await run(deps, A, `Pedimos SQL. ${DEMO_TAILOR_INVENTS_MARK}`)).toEqual({
        ok: false,
        error: { kind: "rejected", reason: "bullet_rejected" },
      });
    }
    expect((await run(deps)).ok).toBe(false);
  });

  it("si el modelo falla sin llegar al proveedor devuelve llm_failed y suelta la reserva", async () => {
    expect(await run(makeDeps({ llm: failingLlm }))).toEqual({
      ok: false,
      error: { kind: "llm_failed" },
    });
    expect(await liveReservations(A)).toBe(0);
  });
});

describe("tailorCv · reservas y topes de gasto", () => {
  const live = (userId: string, ageMs: number, id: string) =>
    conn.db.insert(s.llmCalls).values({
      userId,
      task: LLM_RESERVE_TASK,
      model: "none",
      label: `${CV_TAILOR_LABEL_PREFIX}${id}`,
      tokensOut: 30_000,
      costUsd: null,
      ok: true,
      createdAt: new Date(NOW.getTime() - ageMs),
    });

  it("las reservas vivas de otros pedidos cuentan contra el tope diario", async () => {
    for (const id of ["a", "b", "c"]) await live(A, 1_000, id);
    expect(await run(makeDeps({ now: () => new Date() }))).toEqual({
      ok: false,
      error: { kind: "daily_limit" },
    });
  });

  it("una reserva colgada deja de contar cuando vence", async () => {
    for (const id of ["a", "b", "c"]) await live(A, LLM_RESERVE_TTL_MS + 60_000, id);
    expect((await run(makeDeps({ now: () => new Date() }))).ok).toBe(true);
  });

  it("respeta el tope global de gasto", async () => {
    await conn.db
      .insert(s.llmCalls)
      .values({ userId: B, task: "evaluate_job", model: "m", costUsd: 1, ok: true });
    expect(await run(makeDeps({ caps: { dailyCapUsd: 0.5, userDailyCapUsd: 0 } }))).toEqual({
      ok: false,
      error: { kind: "capped" },
    });
  });

  it("respeta el tope diario de la persona", async () => {
    await conn.db
      .insert(s.llmCalls)
      .values({ userId: A, task: "evaluate_job", model: "m", costUsd: 0.5, ok: true });
    expect(await run(makeDeps({ caps: { dailyCapUsd: 0, userDailyCapUsd: 0.5 } }))).toEqual({
      ok: false,
      error: { kind: "capped" },
    });
  });
});
