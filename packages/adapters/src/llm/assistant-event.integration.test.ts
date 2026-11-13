import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { ASSISTANT_EVENT_MODEL, ASSISTANT_EVENT_TASK, capMarker } from "@job-search-os/pipeline";
import { and, eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  averageTokensFor,
  spendBreakdown,
  spendCapReason,
  spendLast24h,
  spendSince,
} from "./spend";

/**
 * R9-2: las filas marcadoras de charla del asistente (`assistant_event`, costo 0) no cambian el
 * gasto, los topes, los conteos de fallos ni el cupo del asistente. Postgres real, datos ficticios.
 */
const NOW = new Date("2026-12-10T15:00:00.000Z");
const HOUR = 3_600_000;
const USER = "00000000-0000-4000-8000-0000000000a1";
const LABEL = "conv:AAAAAAAAAAAAAAAA";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const chatStep = (over: Partial<typeof s.llmCalls.$inferInsert> = {}) =>
  ({
    userId: USER,
    task: "assistant_chat",
    model: "modelo-ficticio",
    promptVersion: "assistant_chat@v1",
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
    label: LABEL,
    ok: true,
    createdAt: new Date(NOW.getTime() - HOUR),
    ...over,
  }) satisfies typeof s.llmCalls.$inferInsert;

const marker = (promptVersion: string) =>
  ({
    userId: USER,
    task: ASSISTANT_EVENT_TASK,
    model: ASSISTANT_EVENT_MODEL,
    promptVersion,
    tokensIn: null,
    tokensOut: null,
    costUsd: 0,
    label: LABEL,
    ok: true,
    error: null,
    createdAt: new Date(NOW.getTime() - HOUR),
  }) satisfies typeof s.llmCalls.$inferInsert;

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
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

/** Todo lo que mide el gasto y los topes, en una foto comparable. */
async function snapshot() {
  const db = conn.db;
  return {
    all: await spendSince(db, new Date(NOW.getTime() - 24 * HOUR)),
    mine: await spendLast24h(db, () => NOW, { userId: USER }),
    capGlobal: await spendCapReason(db, {
      userId: USER,
      now: () => NOW,
      dailyCapUsd: 0.03,
      userDailyCapUsd: 0.03,
    }),
    breakdown: await spendBreakdown(db, new Date(NOW.getTime() - 24 * HOUR)),
    tokens: await averageTokensFor(db, { model: ASSISTANT_EVENT_MODEL, withReasoning: false }),
  };
}

/** Las mismas condiciones que `loadAssistantUsage` (apps/web/lib/assistant-usage.ts). */
async function assistantUsage() {
  const c = s.llmCalls;
  const [month] = await conn.db
    .select({ n: sql<number>`count(distinct ${c.label})::int` })
    .from(c)
    .where(and(eq(c.userId, USER), eq(c.task, "assistant_chat"), like(c.label, "conv:%")));
  const [conv] = await conn.db
    .select({
      n: sql<number>`count(*)::int`,
      cost: sql<number>`coalesce(sum(${c.costUsd}), 0)::float8`,
      unknown: sql<boolean>`coalesce(bool_or(${c.costUsd} is null), false)`,
    })
    .from(c)
    .where(and(eq(c.userId, USER), eq(c.task, "assistant_chat"), eq(c.label, LABEL)));
  return { month, conv };
}

describe("filas marcadoras del asistente (R9-2)", () => {
  beforeEach(async () => {
    await conn.db.delete(s.llmCalls);
    await conn.db.insert(s.llmCalls).values([
      chatStep(),
      chatStep({ costUsd: 0.02 }),
      // Un paso fallido: es lo único que cuenta como fallo
      chatStep({ ok: false, error: "timeout", costUsd: 0.005 }),
    ]);
  });

  it("no cambian gasto, topes, desglose ni promedios de tokens", async () => {
    const before = await snapshot();
    expect(before.all.calls).toBe(3);
    expect(before.all.failedCalls).toBe(1);

    await conn.db
      .insert(s.llmCalls)
      .values([
        marker("turn"),
        marker("turn"),
        marker(capMarker("turns")),
        marker(capMarker("usd")),
      ]);

    const after = await snapshot();
    expect(after).toEqual(before);
    // El tope de usuario sigue cortando por el gasto real (0,035), no por las filas
    expect(after.capGlobal).toBe("global");
    // En el desglose por tarea no aparece la tarea de los marcadores
    expect(after.breakdown.some((r) => r.task === ASSISTANT_EVENT_TASK)).toBe(false);
  });

  it("no cambian el cupo mensual ni el gasto de la charla del asistente", async () => {
    const before = await assistantUsage();
    await conn.db.insert(s.llmCalls).values([marker("turn"), marker(capMarker("usd"))]);
    expect(await assistantUsage()).toEqual(before);
    // Una charla que solo tiene marcadores no cuenta como charla del cupo
    await conn.db.delete(s.llmCalls);
    await conn.db.insert(s.llmCalls).values(marker("turn"));
    const only = await assistantUsage();
    expect(only.month?.n).toBe(0);
    expect(only.conv?.n).toBe(0);
  });

  it("no son fallos: ninguna lleva error ni ok = false", async () => {
    await conn.db.insert(s.llmCalls).values([marker("turn"), marker(capMarker("steps"))]);
    const rows = await conn.db
      .select({
        withError: sql<number>`count(*) filter (where ${s.llmCalls.error} is not null)::int`,
        failed: sql<number>`count(*) filter (where not ${s.llmCalls.ok})::int`,
      })
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, ASSISTANT_EVENT_TASK));
    expect(rows[0]).toEqual({ withError: 0, failed: 0 });
  });
});
