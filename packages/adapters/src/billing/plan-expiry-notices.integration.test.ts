import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDbNoticeStore, runPlanExpiryNotices } from "./plan-expiry-notices";

/** Aviso de vencimiento (C4-1) contra Postgres real, con el store real y datos 100 % ficticios. */
const DAY = 86_400_000;
const NOW = new Date("2026-12-10T12:15:00.000Z");
const days = (n: number) => new Date(NOW.getTime() + n * DAY);
const ID = (n: number) => `c4000000-0000-4000-8000-00000000000${n}`;
const IDS = [1, 2, 3, 4, 5].map(ID);
const ENV = {
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Aviso <aviso@example.test>",
  AUTH_URL: "https://app.example.test",
  MP_LINK_LISTA: "https://mpago.la/abc",
};

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function addPerson(
  n: number,
  plan: { plan: string; planUntil: Date | null; planSource?: string; planNotifiedAt?: Date | null },
): Promise<void> {
  await conn.db.insert(s.users).values({ id: ID(n), email: `c4-${n}@ejemplo.test` });
  await conn.db.insert(s.profiles).values({
    userId: ID(n),
    displayName: `Persona ${n}`,
    locationCountry: "AR",
    inboundAddress: `u_c4plan0${n}@ingest.test`,
    plan: plan.plan,
    planUntil: plan.planUntil,
    planSource: plan.planSource ?? null,
    planNotifiedAt: plan.planNotifiedAt ?? null,
  });
}

async function notifiedAt(n: number): Promise<Date | null> {
  const [row] = await conn.db
    .select({ at: s.profiles.planNotifiedAt })
    .from(s.profiles)
    .where(eq(s.profiles.userId, ID(n)));
  return row?.at ?? null;
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
  conn = createDb(ownerUrl, { max: 2 });
  await addPerson(1, { plan: "lista", planUntil: days(2), planSource: "pago" }); // vence en 2 días
  await addPerson(2, { plan: "lista", planUntil: days(20), planSource: "pago" }); // lejos
  await addPerson(3, { plan: "gratis", planUntil: null }); // sin plan pago
  await addPerson(4, { plan: "lista", planUntil: days(-1), planSource: "pago" }); // ya venció
  await addPerson(5, { plan: "lista", planUntil: days(1), planSource: "beca" }); // beca, vence mañana
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, IDS));
    await conn.db.delete(s.users).where(inArray(s.users.id, IDS));
  }
  await conn?.close();
  await container?.stop();
});

describe("aviso de vencimiento con el store real (C4-1)", () => {
  // Cada caso parte del mismo estado: sin marcas y con los vencimientos originales
  beforeEach(async () => {
    const original: Record<number, Date | null> = {
      1: days(2),
      2: days(20),
      3: null,
      4: days(-1),
      5: days(1),
    };
    for (const [n, until] of Object.entries(original)) {
      await conn.db
        .update(s.profiles)
        .set({ planUntil: until, planNotifiedAt: null })
        .where(eq(s.profiles.userId, ID(Number(n))));
    }
  });

  it("avisa a quien vence en 3 días o menos, una sola vez, aunque el cron corra dos veces", async () => {
    const store = createDbNoticeStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const first = await runPlanExpiryNotices({ store, env: ENV, now: NOW, logger, send });
    expect(first).toMatchObject({ ok: true, due: 2, sent: 2, failed: 0 });
    // La que vence antes va primero; el cuerpo es texto simple
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["c4-5@ejemplo.test", "c4-1@ejemplo.test"]);
    expect(send.mock.calls[0]![0].text).toMatch(/beca/i);

    expect((await notifiedAt(1))?.getTime()).toBe(NOW.getTime());
    expect((await notifiedAt(5))?.getTime()).toBe(NOW.getTime());
    for (const n of [2, 3, 4]) expect(await notifiedAt(n)).toBeNull();

    // Segunda corrida (cron duplicado un rato después): no repite
    const later = new Date(NOW.getTime() + 10 * 60_000);
    const second = await runPlanExpiryNotices({ store, env: ENV, now: later, logger, send });
    expect(second).toMatchObject({ due: 0, sent: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("dos reclamos sobre el mismo estado leído: gana uno solo", async () => {
    const store = createDbNoticeStore(conn.db);
    const candidates = await store.loadCandidates(NOW);
    const one = candidates.find((c) => c.userId === ID(1));
    expect(one).toBeDefined();
    const results = await Promise.all([store.claim(one!, NOW), store.claim(one!, NOW)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await notifiedAt(1))?.getTime()).toBe(NOW.getTime());
  });

  it("no reclama si el vencimiento cambió después de leer a la persona", async () => {
    const store = createDbNoticeStore(conn.db);
    const candidates = await store.loadCandidates(NOW);
    const one = candidates.find((c) => c.userId === ID(1))!;
    await conn.db
      .update(s.profiles)
      .set({ planUntil: days(30) })
      .where(eq(s.profiles.userId, ID(1)));
    expect(await store.claim(one, NOW)).toBe(false);
    expect(await notifiedAt(1)).toBeNull();
  });

  it("respeta el tope diario con las marcas de hoy", async () => {
    const store = createDbNoticeStore(conn.db);
    const send = vi.fn().mockResolvedValue(undefined);
    const res = await runPlanExpiryNotices({
      store,
      env: { ...ENV, PLAN_NOTICE_DAILY_CAP: "1" },
      now: NOW,
      logger,
      send,
    });
    expect(res).toMatchObject({ sent: 1, capLeft: 0 });
    const again = await runPlanExpiryNotices({
      store,
      env: { ...ENV, PLAN_NOTICE_DAILY_CAP: "1" },
      now: new Date(NOW.getTime() + 60_000),
      logger,
      send,
    });
    expect(again.skipped).toBe("tope_diario");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("si el envío falla devuelve la marca anterior y más tarde se reintenta", async () => {
    const store = createDbNoticeStore(conn.db);
    const failing = vi.fn().mockRejectedValue(new Error("Resend POST /emails: HTTP 500"));
    const res = await runPlanExpiryNotices({ store, env: ENV, now: NOW, logger, send: failing });
    expect(res).toMatchObject({ sent: 0, failed: 2 });
    expect(await notifiedAt(1)).toBeNull();
    expect(await notifiedAt(5)).toBeNull();
    const ok = vi.fn().mockResolvedValue(undefined);
    const hourLater = new Date(NOW.getTime() + 3_600_000);
    const retry = await runPlanExpiryNotices({ store, env: ENV, now: hourLater, logger, send: ok });
    expect(retry.sent).toBe(2);
  });

  it("renovar vuelve a habilitar el aviso del vencimiento siguiente", async () => {
    const store = createDbNoticeStore(conn.db);
    // Ya se la había avisado del vencimiento viejo; renovó 30 días: ahora vence en 32
    await conn.db
      .update(s.profiles)
      .set({ planUntil: days(32), planNotifiedAt: NOW })
      .where(eq(s.profiles.userId, ID(1)));
    const send = vi.fn().mockResolvedValue(undefined);
    // Treinta días después le quedan 2
    const res = await runPlanExpiryNotices({ store, env: ENV, now: days(30), logger, send });
    expect(send.mock.calls.map((c) => c[0].to)).toEqual(["c4-1@ejemplo.test"]);
    expect(res.sent).toBe(1);
  });

  it("sin Resend no marca a nadie", async () => {
    const store = createDbNoticeStore(conn.db);
    const send = vi.fn();
    const res = await runPlanExpiryNotices({
      store,
      env: { ...ENV, RESEND_API_KEY: undefined },
      now: NOW,
      logger,
      send,
    });
    expect(res.skipped).toBe("sin_resend");
    for (const n of [1, 5]) expect(await notifiedAt(n)).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
});
