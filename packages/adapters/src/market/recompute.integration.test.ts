import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MARKET_RECOMPUTE_QUEUE, recomputeMarketForUser } from "./recompute";

/**
 * Ronda 28 · Recálculo de mercado bajo demanda: primera vez, mínimo de 10 segundos entre recálculos, ventana de
 * 10 minutos con y sin cambios, y aislamiento entre usuarios. Datos inventados.
 */
const USER_A = "a0000000-0000-4000-8000-0000000000a1";
const USER_B = "a0000000-0000-4000-8000-0000000000b2";
const SLUG = "recompute_test_skill";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let skillId: string;

const T0 = new Date("2026-01-05T10:00:00.000Z");
const at = (minutes: number, extraMs = 0) => new Date(T0.getTime() + minutes * 60_000 + extraMs);
const run = (userId: string, when: Date, inputsChanged: boolean) =>
  recomputeMarketForUser(conn.db, {
    userId,
    inputsChanged,
    now: () => when,
    sleep: async () => {},
  });

async function marks(userId: string) {
  return conn.db
    .select({ id: s.jobQueue.id })
    .from(s.jobQueue)
    .where(and(eq(s.jobQueue.queue, MARKET_RECOMPUTE_QUEUE), eq(s.jobQueue.userId, userId)));
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
  const [skill] = await conn.db
    .insert(s.skills)
    .values({ slug: SLUG, name: "Skill de prueba", category: s.skillCategory.enumValues[0]! })
    .onConflictDoUpdate({ target: s.skills.slug, set: { name: "Skill de prueba" } })
    .returning({ id: s.skills.id });
  skillId = skill!.id;
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  for (const userId of [USER_A, USER_B]) {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.userId, userId));
    await conn.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, userId));
    await conn.db.delete(s.marketSnapshots).where(eq(s.marketSnapshots.userId, userId));
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
  }
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId: USER_A,
      companyRaw: "Empresa A",
      title: "Backend Engineer",
      titleNormalized: "backend engineer",
    })
    .returning({ id: s.jobs.id });
  await conn.db.insert(s.jobSkills).values({ jobId: job!.id, skillId, isMust: true });
});

describe("recomputeMarketForUser", () => {
  it("la primera vez corre, deja la marca y escribe el snapshot", async () => {
    const r = await run(USER_A, T0, true);
    expect(r).toMatchObject({ ran: true, jobs: 1, skills: 1 });
    expect(await marks(USER_A)).toHaveLength(1);
    const snap = await conn.db
      .select({ id: s.marketSnapshots.id })
      .from(s.marketSnapshots)
      .where(eq(s.marketSnapshots.userId, USER_A));
    expect(snap).toHaveLength(1);
  });

  it("una segunda inmediata sin cambios no corre", async () => {
    await run(USER_A, T0, true);
    expect(await run(USER_A, at(0, 5_000), false)).toEqual({ ran: false, reason: "piso" });
    expect(await marks(USER_A)).toHaveLength(1);
  });

  it("con cambios a los 3 segundos espera lo que falta y corre", async () => {
    await run(USER_A, T0, true);
    let clock = at(0, 3_000);
    const waits: number[] = [];
    const r = await recomputeMarketForUser(conn.db, {
      userId: USER_A,
      inputsChanged: true,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock = new Date(clock.getTime() + ms);
      },
    });
    expect(r.ran).toBe(true);
    expect(waits).toEqual([7_000]);
    expect(await marks(USER_A)).toHaveLength(2);
  });

  it("sin cambios a los 3 segundos no espera y sale sin correr", async () => {
    await run(USER_A, T0, true);
    const waits: number[] = [];
    const r = await recomputeMarketForUser(conn.db, {
      userId: USER_A,
      inputsChanged: false,
      now: () => at(0, 3_000),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(r).toEqual({ ran: false, reason: "piso" });
    expect(waits).toEqual([]);
  });

  it("si después de esperar sigue dentro del mínimo, devuelve el mismo resultado", async () => {
    await run(USER_A, T0, true);
    const r = await recomputeMarketForUser(conn.db, {
      userId: USER_A,
      inputsChanged: true,
      now: () => at(0, 3_000),
      sleep: async () => {},
    });
    expect(r).toEqual({ ran: false, reason: "piso" });
  });

  it("a los 30 segundos con cambios corre", async () => {
    await run(USER_A, T0, true);
    expect((await run(USER_A, at(0, 30_000), true)).ran).toBe(true);
  });

  it("a los 5 minutos sin cambios no corre (ventana)", async () => {
    await run(USER_A, T0, true);
    expect(await run(USER_A, at(5), false)).toEqual({ ran: false, reason: "ventana" });
  });

  it("a los 5 minutos con cambios corre", async () => {
    await run(USER_A, T0, true);
    expect((await run(USER_A, at(5), true)).ran).toBe(true);
    expect(await marks(USER_A)).toHaveLength(2);
  });

  it("la primera ingesta (con cambios) a los 2 minutos de un guardado corre", async () => {
    await run(USER_A, T0, true);
    expect((await run(USER_A, at(2), true)).ran).toBe(true);
  });

  it("a los 11 minutos sin cambios corre", async () => {
    await run(USER_A, T0, true);
    expect((await run(USER_A, at(11), false)).ran).toBe(true);
  });

  it("dos guardados simultáneos corren una sola vez", async () => {
    const results = await Promise.all([run(USER_A, T0, true), run(USER_A, T0, true)]);
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(await marks(USER_A)).toHaveLength(1);
  });

  it("otro usuario no se ve afectado por la marca de A", async () => {
    await run(USER_A, T0, true);
    const r = await run(USER_B, at(0, 1_000), false);
    expect(r).toMatchObject({ ran: true, jobs: 0 });
    expect(await marks(USER_B)).toHaveLength(1);
  });
});
