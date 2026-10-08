import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import page from "../sources/__fixtures__/getonboard-search-page.json";
import { mapGobJob, type GobJobItem, type GobPage } from "../sources/getonboard";
import { runGetOnBoardIngest } from "./run-getonboard";
import { runExtraSourcesIngest, type ExtraSourceDownloaders } from "./run-sources";

/**
 * Ronda 22 · La ingesta inmediata de un usuario nuevo corre solo para él. Sin red: las fuentes
 * son falsas (fetch y descargadores inyectados).
 */
const USER_A = "a0000000-0000-4000-8000-0000000000a1";
const USER_B = "a0000000-0000-4000-8000-0000000000b2";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const gob = (page as unknown as GobPage).data as GobJobItem[];

const now = () => new Date("2026-09-11T00:00:00Z");
const fakeFetch = (async () =>
  new Response(JSON.stringify({ data: gob, meta: { page: 1, per_page: 100, total_pages: 1 } }), {
    status: 200,
  })) as unknown as typeof fetch;
const downloaders = (() => {
  const none = async () => [];
  return {
    remoteok: async () => gob.map((i) => mapGobJob(i, "fake")),
    wwr: none,
    himalayas: none,
    torre: none,
  };
})() as ExtraSourceDownloaders;

const common = {
  db: undefined as never,
  logger,
  sinceHours: 24 * 60,
  now,
  enqueueEvaluation: null,
};

async function jobsOf(userId: string) {
  return conn.db.select({ id: s.jobs.id }).from(s.jobs).where(eq(s.jobs.userId, userId));
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
  common.db = conn.db as never;
  for (const [userId, tag] of [
    [USER_A, "a1"],
    [USER_B, "b2"],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Test",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: `u_${tag}@ingest.test`,
        profileSummary: "AI Engineer.",
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId, version: 1, active: true, rules: criteria as never })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  for (const userId of [USER_A, USER_B]) {
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
  }
});

describe("ingesta de un solo usuario", () => {
  it("Get on Board con userId = A no crea ofertas para B", async () => {
    const r = await runGetOnBoardIngest({
      ...common,
      userId: USER_A,
      categories: ["fake"],
      fetchImpl: fakeFetch,
    });
    expect(r.users.map((u) => u.userId)).toEqual([USER_A]);
    expect((await jobsOf(USER_A)).length).toBeGreaterThan(0);
    expect(await jobsOf(USER_B)).toHaveLength(0);
  });

  it("fuentes extra con userId = A no crean ofertas para B", async () => {
    const r = await runExtraSourcesIngest({
      ...common,
      userId: USER_A,
      enabled: ["remoteok"],
      downloaders,
    });
    expect(r.sources[0]?.status).toBe("ok");
    expect(r.sources[0]?.users).toBe(1);
    expect((await jobsOf(USER_A)).length).toBeGreaterThan(0);
    expect(await jobsOf(USER_B)).toHaveLength(0);
  });

  it("sin userId, las dos corren para todos los perfiles con criterios", async () => {
    const g = await runGetOnBoardIngest({ ...common, categories: ["fake"], fetchImpl: fakeFetch });
    expect(g.users.map((u) => u.userId).sort()).toEqual([USER_A, USER_B]);
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER_A));
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER_B));

    const r = await runExtraSourcesIngest({ ...common, enabled: ["remoteok"], downloaders });
    expect(r.sources[0]?.users).toBe(2);
    expect((await jobsOf(USER_A)).length).toBeGreaterThan(0);
    expect((await jobsOf(USER_B)).length).toBeGreaterThan(0);
  });
});
