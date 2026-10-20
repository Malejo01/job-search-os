import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { RawJob } from "@job-search-os/pipeline";
import { eq, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolDownloaders } from "../pool/fetch";
import { runIngestCron } from "./ingest";

/**
 * Ronda 62 · runIngestCron de punta a punta con un descargador falso (sin red ni LLM).
 * Datos inventados (Empresa Ficticia N, example.com). Corre como dueño, igual que el servicio.
 */
const USER = "c0000000-0000-4000-8000-0000000000c1";
const PREFIX = "cron-ing-";
const logger = pino({ level: "silent" });

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

function rawJob(id: string): RawJob {
  return {
    source: {
      kind: "remoteok",
      name: "Remote OK",
      externalId: `${PREFIX}${id}`,
      url: `https://example.com/jobs/${PREFIX}${id}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify({ id }) },
    },
    title: "QA Engineer",
    companyRaw: `Empresa Ficticia ${id}`,
    locationRaw: "Remoto (Worldwide)",
    countriesAllowed: ["*"],
    modality: "remoto",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: `Descripción inventada número ${id} para pruebas del cron, sin datos reales de nadie.`,
    postedAt: new Date(Date.now() - 3_600_000),
    tags: [],
    categories: ["engineering"],
    seniority: null,
    lang: null,
  };
}

const fail = async () => {
  throw new Error("no debería llamarse");
};
const downloaders: PoolDownloaders = {
  getonboard: fail,
  remoteok: async () => [rawJob("1"), rawJob("2"), rawJob("3")],
  jobicy: fail,
  himalayas: fail,
  wwr: fail,
  greenhouse: fail,
  lever: fail,
  ashby: fail,
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
      targetRole: "qa",
      targetRoles: ["qa"],
      inboundAddress: "u_cron_c1@ingest.test",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

beforeEach(() => {
  // Con Get on Board fuera del pool, la ingesta por usuario usa el fetch global: sin red, vacío.
  vi.stubGlobal("fetch", async () =>
    Response.json({ data: [], meta: { page: 1, per_page: 100, total_pages: 1 } }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("runIngestCron", () => {
  it("pool con descargador falso: ok, fuente insertada, fila de fetch y body sin ids", async () => {
    const result = await runIngestCron({
      db: conn.db,
      logger,
      env: { POOL_SOURCES: "remoteok" },
      poolDownloaders: downloaders,
    });
    expect(result.ok).toBe(true);
    expect(result.body.ok).toBe(true);
    expect(result.body.gob).toBe("por_usuario");
    const pool = result.body.pool as { sources: { name: string; inserted?: number }[] };
    expect(pool.sources[0]).toMatchObject({ name: "remoteok", inserted: 3 });
    expect(typeof result.body.durationMs).toBe("number");
    expect(result.body.assigned).toBeDefined();
    // Sin pasos fallidos no aparece la clave
    expect(result.body.failed).toBeUndefined();

    const rows = await conn.db
      .select()
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));
    expect(rows).toHaveLength(3);
    const fetches = await conn.db
      .select()
      .from(s.publicJobFetches)
      .where(eq(s.publicJobFetches.sourceKind, "remoteok"));
    expect(fetches).toHaveLength(1);
    expect(fetches[0]).toMatchObject({ status: "ok" });

    const text = JSON.stringify(result.body);
    expect(text).not.toContain(USER);
    for (const row of rows) expect(text).not.toContain(row.externalId);
    expect(text).not.toContain(PREFIX);
  });

  it("POOL_SOURCES vacío: ok, sin clave pool y sin tocar public_job_fetches", async () => {
    const before = await conn.db.select().from(s.publicJobFetches);
    const result = await runIngestCron({
      db: conn.db,
      logger,
      env: { POOL_SOURCES: "" },
      poolDownloaders: downloaders,
    });
    expect(result.ok).toBe(true);
    expect(result.body).not.toHaveProperty("pool");
    const after = await conn.db.select().from(s.publicJobFetches);
    expect(after).toHaveLength(before.length);
  });
});
