import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spendSinceQuery } from "./spend";
import {
  liveReservationsQuery,
  reserveLlmSpend,
  SPEND_LOCK_KEY,
  SPEND_LOCK_NAMESPACE,
} from "./spend-reserve";

/**
 * Locks de gasto sin cola y con índice. Postgres real, datos ficticios. El lock global lo retiene una
 * transacción aparte para ver cuánto espera cada reserva.
 */
const A = "a3500000-0000-4000-8000-000000000001";
const B = "b3500000-0000-4000-8000-000000000002";
const LOCK_TIMEOUT_MS = 400;

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

/** Toma el lock global de reservas y lo retiene hasta llamar a `release`. */
async function holdGlobalLock(): Promise<{ release: () => void }> {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const got = new Promise<void>((resolve) => (acquired = resolve));
  void conn.sql
    .begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${SPEND_LOCK_KEY}, ${SPEND_LOCK_NAMESPACE}))`;
      acquired();
      await released;
    })
    .catch(() => undefined);
  await got;
  return { release };
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
  // Pool grande: 20 reservas en paralelo no tienen que hacer cola por conexión
  conn = createDb(ownerUrl, { max: 40 });
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls);
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("reserva de gasto bajo el lock global", () => {
  it("una cuenta topeada se rechaza sin tomar el lock global", async () => {
    await conn.db.insert(s.llmCalls).values({
      userId: A,
      task: "evaluate_job",
      model: "modelo-ficticio",
      costUsd: 0.5,
      ok: true,
    });
    const lock = await holdGlobalLock();
    try {
      const started = Date.now();
      const r = await reserveLlmSpend(conn.db, {
        userId: A,
        estimateUsd: 0.01,
        dailyCapUsd: 0,
        userDailyCapUsd: 0.5,
        lockTimeoutMs: 3000,
      });
      expect(r).toEqual({ ok: false, reason: "user" });
      // Si hubiera esperado el lock, habría tardado el lock_timeout entero
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      lock.release();
    }
  });

  it("por encima del límite de reservas vivas se rechaza sin tomar el lock global", async () => {
    const caps = { dailyCapUsd: 0, userDailyCapUsd: 0, maxConcurrent: 3, estimateUsd: 0.01 };
    for (let i = 0; i < 3; i++) {
      const ok = await reserveLlmSpend(conn.db, { userId: A, ...caps });
      expect(ok.ok).toBe(true);
    }
    const lock = await holdGlobalLock();
    try {
      const started = Date.now();
      const r = await reserveLlmSpend(conn.db, { userId: A, ...caps, lockTimeoutMs: 3000 });
      expect(r).toEqual({ ok: false, reason: "concurrent" });
      expect(Date.now() - started).toBeLessThan(1000);
    } finally {
      lock.release();
    }
    // Otra persona no se ve afectada
    expect((await reserveLlmSpend(conn.db, { userId: B, ...caps })).ok).toBe(true);
  });

  it("20 reservas en paralelo con el lock tomado: ninguna espera más que el lock_timeout", async () => {
    const lock = await holdGlobalLock();
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, async (_, i) => {
          const started = Date.now();
          const r = await reserveLlmSpend(conn.db, {
            userId: i % 2 === 0 ? A : B,
            estimateUsd: 0.01,
            dailyCapUsd: 0,
            userDailyCapUsd: 0,
            maxConcurrent: 100,
            lockTimeoutMs: LOCK_TIMEOUT_MS,
          });
          return { r, ms: Date.now() - started };
        }),
      );
      for (const { r, ms } of results) {
        expect(r).toEqual({ ok: false, reason: "lock_timeout" });
        expect(ms).toBeLessThan(LOCK_TIMEOUT_MS + 1500);
      }
    } finally {
      lock.release();
    }
    // Fallar cerrado: ninguna reserva quedó anotada
    expect(await conn.db.select().from(s.llmCalls)).toHaveLength(0);
  });

  it("con el lock libre vuelve a reservar", async () => {
    const r = await reserveLlmSpend(conn.db, {
      userId: A,
      estimateUsd: 0.01,
      dailyCapUsd: 0,
      userDailyCapUsd: 0,
      lockTimeoutMs: LOCK_TIMEOUT_MS,
    });
    expect(r.ok).toBe(true);
  });
});

describe("las mediciones de gasto usan índice", () => {
  const NOW = new Date("2026-11-12T12:00:00.000Z");
  const since = new Date(NOW.getTime() - 24 * 3_600_000);

  /** Plan de una consulta de drizzle, sin ejecutarla: EXPLAIN con sus parámetros reales. */
  async function plan(q: { toSQL: () => { sql: string; params: unknown[] } }): Promise<string> {
    const { sql: text, params } = q.toSQL();
    const rows = await conn.sql.unsafe(`explain ${text}`, params as never[]);
    return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
  }

  beforeAll(async () => {
    await conn.db.delete(s.llmCalls);
    // Historia vieja (la mayoría) y una cola reciente: así es la tabla en producción
    const rows = Array.from({ length: 8000 }, (_, i) => ({
      userId: i % 7 === 0 ? A : `c3500000-0000-4000-8000-${String(i % 50).padStart(12, "0")}`,
      task: i % 5 === 0 ? "evaluate_job" : i % 5 === 1 ? "llm_reserve" : "draft_application",
      model: "modelo-ficticio",
      costUsd: 0.01,
      tokensOut: 100,
      ok: true,
      createdAt: new Date(
        i < 7800
          ? NOW.getTime() - (2 + (i % 90)) * 24 * 3_600_000
          : NOW.getTime() - (i % 20) * 60_000,
      ),
    }));
    for (let i = 0; i < rows.length; i += 1000) {
      await conn.db.insert(s.llmCalls).values(rows.slice(i, i + 1000));
    }
    await conn.sql.unsafe("analyze llm_calls");
  }, 120_000);

  it("la suma global de 24 h no recorre toda la tabla", async () => {
    expect(await plan(spendSinceQuery(conn.db, since))).not.toMatch(/Seq Scan on llm_calls/);
  });

  it("la suma de una persona no recorre toda la tabla", async () => {
    expect(await plan(spendSinceQuery(conn.db, since, { userId: A }))).not.toMatch(
      /Seq Scan on llm_calls/,
    );
  });

  it("la suma de reservas vivas no recorre toda la tabla", async () => {
    const q = liveReservationsQuery(conn.db, NOW);
    expect(await plan(q)).not.toMatch(/Seq Scan on llm_calls/);
  });
});
