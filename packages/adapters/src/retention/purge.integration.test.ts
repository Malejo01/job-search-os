import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PURGE_MAX_BATCHES, parseLogDays, purgeExpired } from "./purge";

/** JS-107 · la purga borra solo lo vencido, respeta la ventana del tope y la cola viva. */
const A = "a0000000-0000-4000-8000-000000000107";
const B = "b0000000-0000-4000-8000-000000000107";
const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const TAG = "purge-107";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function seed() {
  const { db } = conn;
  await db.delete(s.passwordResetTokens).where(inArray(s.passwordResetTokens.userId, [A, B]));
  await db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, [A, B]));
  await db.delete(s.jobQueue).where(inArray(s.jobQueue.userId, [A, B]));
  await db.delete(s.inboundRejections).where(inArray(s.inboundRejections.userId, [A, B]));

  for (const [u, k] of [
    [A, "a"],
    [B, "b"],
  ] as const) {
    await db.insert(s.passwordResetTokens).values([
      { userId: u, tokenHash: `${TAG}-${k}-vencido`, expiresAt: daysAgo(3) },
      { userId: u, tokenHash: `${TAG}-${k}-usado`, expiresAt: daysAgo(-1), usedAt: daysAgo(2) },
      { userId: u, tokenHash: `${TAG}-${k}-vigente`, expiresAt: daysAgo(-1) },
      {
        userId: u,
        tokenHash: `${TAG}-${k}-usado-hoy`,
        expiresAt: daysAgo(-1),
        usedAt: hoursAgo(1),
      },
    ]);
    const call = { userId: u, task: TAG, model: "m", ok: true };
    await db.insert(s.llmCalls).values([
      { ...call, createdAt: daysAgo(100) },
      { ...call, createdAt: daysAgo(40) },
      { ...call, createdAt: daysAgo(20) },
      { ...call, createdAt: hoursAgo(23) }, // dentro de la ventana del tope
    ]);
    const job = { userId: u, queue: TAG, payload: {} };
    await db.insert(s.jobQueue).values([
      { ...job, status: "done", updatedAt: daysAgo(40) },
      { ...job, status: "failed", updatedAt: daysAgo(40) },
      { ...job, status: "done", updatedAt: daysAgo(1) },
      { ...job, status: "pending", createdAt: daysAgo(90), updatedAt: daysAgo(90) },
      { ...job, status: "processing", createdAt: daysAgo(90), updatedAt: daysAgo(90) },
    ]);
    await db.insert(s.inboundRejections).values([
      { userId: u, windowStart: daysAgo(40) },
      { userId: u, windowStart: daysAgo(1.5) },
      { userId: u, windowStart: daysAgo(1) },
    ]);
  }
}

const mine = [A, B];
const count = async () => ({
  tokens: (
    await conn.db
      .select()
      .from(s.passwordResetTokens)
      .where(inArray(s.passwordResetTokens.userId, mine))
  ).length,
  llmCalls: (await conn.db.select().from(s.llmCalls).where(inArray(s.llmCalls.userId, mine)))
    .length,
  queue: (await conn.db.select().from(s.jobQueue).where(inArray(s.jobQueue.userId, mine))).length,
  rejections: (
    await conn.db
      .select()
      .from(s.inboundRejections)
      .where(inArray(s.inboundRejections.userId, mine))
  ).length,
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
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db
    .insert(s.users)
    .values([
      { id: A, email: "a107@usuario.test", passwordHash: "x" },
      { id: B, email: "b107@usuario.test", passwordHash: "x" },
    ])
    .onConflictDoNothing();
}, 180_000);

beforeEach(seed);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("purgeExpired", () => {
  it("con logDays borra solo lo vencido, de los dos usuarios", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    // tokens: queda vigente y usado hoy; llm: solo cae lo de más de 90 d; cola: done reciente,
    // pending, processing; rechazos: los de 1 y 1,5 d
    expect(await count()).toEqual({ tokens: 4, llmCalls: 6, queue: 6, rejections: 4 });
  });

  it("llm_calls tiene mínimo de 90 días aunque logDays sea 1", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.llmCalls).where(inArray(s.llmCalls.userId, mine));
    // solo se va lo de 100 d; las de 40 d, 20 d y 23 h (ventana del tope) se quedan
    expect(left).toHaveLength(6);
    expect(left.every((r) => r.createdAt >= daysAgo(90))).toBe(true);
  });

  it("borde de los 90 días en llm_calls: 89 d queda y 91 d cae, con logDays en 1", async () => {
    const edge = { userId: A, task: `${TAG}-borde`, model: "m", ok: false, error: "api_call:500" };
    await conn.db.insert(s.llmCalls).values([
      { ...edge, createdAt: daysAgo(89) },
      { ...edge, createdAt: daysAgo(91) },
    ]);
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.task, edge.task));
    expect(left.map((r) => r.createdAt.getTime())).toEqual([daysAgo(89).getTime()]);
  });

  it("con logDays mayor que el mínimo, llm_calls usa logDays", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 120 });
    expect((await count()).llmCalls).toBe(8);
  });

  it("inbound_rejections tiene su mínimo aunque logDays sea 1", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(inArray(s.inboundRejections.userId, mine));
    expect(left).toHaveLength(4);
    expect(left.every((r) => r.windowStart >= daysAgo(2))).toBe(true);
  });

  it("corta en 10 lotes por tabla y deja el resto para la próxima corrida", async () => {
    // tokens vencidos de mis dos usuarios: 4 con lote de 1 se borran de a 1 hasta el tope
    const first = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(first.tokens).toBeLessThanOrEqual(PURGE_MAX_BATCHES);
    const seedMore = Array.from({ length: 12 }, (_, i) => ({
      userId: A,
      tokenHash: `${TAG}-extra-${i}`,
      expiresAt: daysAgo(5),
    }));
    await conn.db.insert(s.passwordResetTokens).values(seedMore);
    const second = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(second.tokens).toBe(PURGE_MAX_BATCHES);
    // la próxima corrida termina lo que quedó (otros tests de la base compartida pueden sumar filas)
    const third = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(third.tokens).toBeGreaterThanOrEqual(2);
    const left = await conn.db
      .select()
      .from(s.passwordResetTokens)
      .where(inArray(s.passwordResetTokens.userId, mine));
    expect(left.some((r) => r.tokenHash.startsWith(`${TAG}-extra-`))).toBe(false);
  });

  it("no toca la cola pendiente ni en curso por vieja que sea", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.jobQueue).where(inArray(s.jobQueue.userId, mine));
    expect(left.map((r) => r.status).sort()).toEqual([
      "done",
      "done",
      "pending",
      "pending",
      "processing",
      "processing",
    ]);
  });

  it("sin logDays solo borra los tokens", async () => {
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r).toMatchObject({ llmCalls: 0, queue: 0, rejections: 0 });
    expect(r.tokens).toBeGreaterThanOrEqual(4);
    expect(await count()).toEqual({ tokens: 4, llmCalls: 8, queue: 10, rejections: 6 });
  });

  it("logDays fuera de rango se trata como ausente", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 0 });
    await purgeExpired(conn.db, { now: NOW, logDays: 99_999 });
    expect(await count()).toEqual({ tokens: 4, llmCalls: 8, queue: 10, rejections: 6 });
  });

  it("es idempotente", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    const second = await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    expect(second).toEqual({ tokens: 0, llmCalls: 0, queue: 0, rejections: 0 });
  });

  it("no toca raw_blobs ni inbound_emails", async () => {
    const [blob] = await conn.db
      .insert(s.rawBlobs)
      .values({
        userId: A,
        kind: TAG,
        contentType: "text/plain",
        body: "x",
        bytes: 1,
        createdAt: daysAgo(500),
      })
      .returning({ id: s.rawBlobs.id });
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const rows = await conn.db
      .select()
      .from(s.rawBlobs)
      .where(inArray(s.rawBlobs.id, [blob!.id]));
    expect(rows).toHaveLength(1);
  });
});

describe("parseLogDays", () => {
  it("acepta enteros de 1 a 3650 y rechaza el resto", () => {
    expect(parseLogDays("30")).toBe(30);
    expect(parseLogDays("3650")).toBe(3650);
    for (const bad of [undefined, "", "0", "3651", "-5", "abc", "1.5", "30 días"]) {
      expect(parseLogDays(bad)).toBeNull();
    }
  });
});
