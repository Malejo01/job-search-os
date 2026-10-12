import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import type { RawJob } from "@job-search-os/pipeline";
import { and, eq, gte, inArray, like, lt, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPoolFetch, type PoolDownloaders } from "./fetch";

/**
 * Ronda 37 · Descarga orquestada del pool, de punta a punta con descargadores falsos.
 * Sin red ni LLM; avisos inventados (Empresa Ficticia N). Corre como dueño, igual que el servicio.
 */
const PREFIX = "fetch-test-";
const logger = pino({ level: "silent" });
const NOW = new Date("2026-10-12T12:00:00Z");
const DAY_START = new Date("2026-10-12T00:00:00Z");
const DAY_END = new Date("2026-10-13T00:00:00Z");

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

function rawJob(kind: "remoteok" | "jobicy", id: string, title: string): RawJob {
  return {
    source: {
      kind,
      name: kind === "remoteok" ? "Remote OK" : "Jobicy",
      externalId: `${PREFIX}${id}`,
      url: `https://example.com/jobs/${PREFIX}${id}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify({ id }) },
    },
    title,
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
    jdText: `Descripción inventada número ${id} para pruebas del pool, sin datos reales de nadie.`,
    postedAt: new Date("2026-10-11T08:00:00Z"),
    tags: [],
    categories: ["engineering"],
    seniority: null,
    lang: null,
  };
}

const downloaders: PoolDownloaders = {
  getonboard: async () => {
    throw new Error("no debería llamarse");
  },
  remoteok: async () => [
    rawJob("remoteok", "1", "Backend Developer"),
    rawJob("remoteok", "2", "Product Designer"),
  ],
  jobicy: async () => [rawJob("jobicy", "3", "Data Analyst")],
  himalayas: async () => {
    throw new Error("no debería llamarse");
  },
};

async function cleanup() {
  const mine = await conn.db
    .select({ id: s.publicJobs.id, rawRef: s.publicJobs.rawRef })
    .from(s.publicJobs)
    .where(like(s.publicJobs.externalId, `${PREFIX}%`));
  if (mine.length) {
    await conn.db.delete(s.publicJobs).where(
      inArray(
        s.publicJobs.id,
        mine.map((m) => m.id),
      ),
    );
    const blobIds = mine.map((m) => m.rawRef?.slice(3)).filter((x): x is string => Boolean(x));
    if (blobIds.length) await conn.db.delete(s.rawBlobs).where(inArray(s.rawBlobs.id, blobIds));
  }
  await conn.db
    .delete(s.publicJobFetches)
    .where(
      and(
        inArray(s.publicJobFetches.sourceKind, ["remoteok", "jobicy"]),
        gte(s.publicJobFetches.startedAt, DAY_START),
        lt(s.publicJobFetches.startedAt, DAY_END),
      ),
    );
}

async function fetchRows() {
  return conn.db
    .select()
    .from(s.publicJobFetches)
    .where(
      and(
        inArray(s.publicJobFetches.sourceKind, ["remoteok", "jobicy"]),
        gte(s.publicJobFetches.startedAt, DAY_START),
        lt(s.publicJobFetches.startedAt, DAY_END),
      ),
    );
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
  await cleanup();
}, 180_000);

afterAll(async () => {
  if (conn) {
    await cleanup();
    await conn.close();
  }
  await container?.stop();
});

describe("runPoolFetch con la base real", () => {
  it("la primera corrida escribe public_jobs y una fila ok por fuente; la segunda saltea por intervalo", async () => {
    const options = {
      db: conn.db,
      logger,
      enabled: ["remoteok", "jobicy"] as const,
      now: () => NOW,
      downloaders,
    };
    const first = await runPoolFetch({ ...options, enabled: [...options.enabled] });
    expect(first.ok).toBe(true);
    expect(first.sources).toMatchObject([
      { name: "remoteok", status: "ok", fetched: 2, inserted: 2 },
      { name: "jobicy", status: "ok", fetched: 1, inserted: 1 },
    ]);

    const [jobs] = await conn.db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));
    expect(jobs!.n).toBe(3);

    const rows = await fetchRows();
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("ok");
      expect(r.finishedAt).not.toBeNull();
      expect(r.errorCode).toBeNull();
      expect(r.durationMs).not.toBeNull();
    }
    expect(rows.find((r) => r.sourceKind === "remoteok")).toMatchObject({
      fetched: 2,
      inserted: 2,
    });
    expect(rows.find((r) => r.sourceKind === "jobicy")).toMatchObject({ fetched: 1, inserted: 1 });

    // Segunda llamada inmediata: dentro de las 5 h, no descarga ni registra filas nuevas
    const second = await runPoolFetch({
      ...options,
      enabled: [...options.enabled],
      now: () => new Date(NOW.getTime() + 60_000),
      downloaders: {
        ...downloaders,
        remoteok: async () => {
          throw new Error("no debería llamarse");
        },
        jobicy: async () => {
          throw new Error("no debería llamarse");
        },
      },
    });
    expect(second.sources).toEqual([
      { name: "remoteok", status: "skipped", fetched: 0, skipped: "intervalo" },
      { name: "jobicy", status: "skipped", fetched: 0, skipped: "intervalo" },
    ]);
    expect(await fetchRows()).toHaveLength(2);
  });

  it("una fuente que falla deja su fila con error_code cerrado", async () => {
    await cleanup();
    const out = await runPoolFetch({
      db: conn.db,
      logger,
      enabled: ["jobicy"],
      now: () => NOW,
      downloaders: {
        ...downloaders,
        jobicy: async () => {
          throw new Error("Jobicy: HTTP 429");
        },
      },
    });
    expect(out.ok).toBe(false);
    expect(out.sources[0]).toMatchObject({ status: "error", error: "http_429" });
    const [row] = await conn.db
      .select()
      .from(s.publicJobFetches)
      .where(
        and(
          eq(s.publicJobFetches.sourceKind, "jobicy"),
          gte(s.publicJobFetches.startedAt, DAY_START),
        ),
      );
    expect(row).toMatchObject({ status: "error", errorCode: "http_429" });

    // Tras un 429 sin ninguna corrida buena, se vuelve a intentar (no hay corrida ok que medir)
    const again = await runPoolFetch({
      db: conn.db,
      logger,
      enabled: ["jobicy"],
      now: () => new Date(NOW.getTime() + 60_000),
      downloaders,
    });
    expect(again.sources[0]).toMatchObject({ status: "ok", inserted: 1 });
  });
});
