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

function rawJob(kind: "remoteok" | "jobicy" | "greenhouse", id: string, title: string): RawJob {
  return {
    source: {
      kind,
      name: kind === "remoteok" ? "Remote OK" : kind === "jobicy" ? "Jobicy" : "Greenhouse",
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
  wwr: async () => {
    throw new Error("no debería llamarse");
  },
  greenhouse: async () => {
    throw new Error("no debería llamarse");
  },
  lever: async () => {
    throw new Error("no debería llamarse");
  },
  ashby: async () => {
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
        inArray(s.publicJobFetches.sourceKind, ["remoteok", "jobicy", "greenhouse"]),
        gte(s.publicJobFetches.startedAt, DAY_START),
        lt(s.publicJobFetches.startedAt, DAY_END),
      ),
    );
  await conn.db.delete(s.atsBoards).where(like(s.atsBoards.token, `${PREFIX}%`));
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

  it("la primera corrida hace backfill; la segunda (con force) parte de la última ok menos 6 h", async () => {
    await cleanup();
    const sinces: Date[] = [];
    const recording: PoolDownloaders = {
      ...downloaders,
      remoteok: async ({ since }) => {
        sinces.push(since);
        return [rawJob("remoteok", "1", "Backend Developer")];
      },
    };
    const run = (now: Date) =>
      runPoolFetch({
        db: conn.db,
        logger,
        enabled: ["remoteok"],
        now: () => now,
        force: true,
        backfillDays: 14,
        downloaders: recording,
      });

    await run(NOW);
    expect(sinces[0]!.getTime()).toBe(NOW.getTime() - 14 * 24 * 3_600_000);

    const [ok] = await fetchRows();
    expect(ok!.status).toBe("ok");
    await run(new Date(NOW.getTime() + 8 * 3_600_000));
    expect(sinces[1]!.getTime()).toBe(ok!.startedAt.getTime() - 6 * 3_600_000);

    // Una partial no cuenta: tras marcar la ok como partial, vuelve el backfill
    await conn.db
      .update(s.publicJobFetches)
      .set({ status: "partial" })
      .where(eq(s.publicJobFetches.sourceKind, "remoteok"));
    const later = new Date(NOW.getTime() + 9 * 3_600_000);
    await run(later);
    expect(sinces[2]!.getTime()).toBe(later.getTime() - 14 * 24 * 3_600_000);
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

describe("runPoolFetch con boards de ats_boards", () => {
  const T = (suffix: string) => `${PREFIX}${suffix}`;
  const run = (greenhouse: PoolDownloaders["greenhouse"]) =>
    runPoolFetch({
      db: conn.db,
      logger,
      enabled: ["greenhouse"],
      now: () => NOW,
      force: true,
      clock: () => 0,
      downloaders: { ...downloaders, greenhouse },
    });

  it("sin boards habilitados de la prueba, la fuente no descarga (no hay filas propias)", async () => {
    await cleanup();
    const seen: string[] = [];
    await run(async ({ boards = [] }) => {
      seen.push(...boards.map((b) => b.token).filter((t) => t.startsWith(PREFIX)));
      return [];
    });
    expect(seen).toEqual([]);
  });

  it("lee los boards enabled por last_fetch_at (nulos primero), actualiza estado y un fallo no corta a los demás", async () => {
    await cleanup();
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    await conn.db.insert(s.atsBoards).values([
      {
        provider: "greenhouse",
        token: T("a"),
        companyName: "Empresa Ficticia 1",
        lastFetchAt: hoursAgo(1),
      },
      { provider: "greenhouse", token: T("b"), companyName: "Empresa Ficticia 2" },
      {
        provider: "greenhouse",
        token: T("c"),
        companyName: "Empresa Ficticia 3",
        lastFetchAt: hoursAgo(5),
      },
      {
        provider: "greenhouse",
        token: T("off"),
        companyName: "Empresa Ficticia 4",
        enabled: false,
      },
      { provider: "lever", token: T("otro"), companyName: "Empresa Ficticia 5" },
    ]);

    const order: string[] = [];
    const out = await run(async ({ boards = [] }) => {
      const mine = boards.filter((b) => b.token.startsWith(PREFIX));
      order.push(...mine.map((b) => b.token));
      const outcomes = mine.map((b) => ({
        id: b.id,
        token: b.token,
        status:
          b.token === T("a")
            ? ("timeout" as const)
            : b.token === T("c")
              ? ("not_found" as const)
              : ("ok" as const),
        fetched: b.token === T("b") ? 1 : 0,
        truncated: 0,
      }));
      return {
        jobs: [rawJob("greenhouse", "g1", "Backend Developer")],
        partialError: "timeout" as const,
        boards: outcomes,
      };
    });

    expect(order).toEqual([T("b"), T("c"), T("a")]);
    expect(out.sources[0]).toMatchObject({ name: "greenhouse", status: "partial", inserted: 1 });

    const rows = await conn.db
      .select()
      .from(s.atsBoards)
      .where(like(s.atsBoards.token, `${PREFIX}%`));
    const by = Object.fromEntries(rows.map((r) => [r.token, r]));
    expect(by[T("a")]).toMatchObject({ lastStatus: "timeout" });
    expect(by[T("b")]).toMatchObject({ lastStatus: "ok" });
    expect(by[T("c")]).toMatchObject({ lastStatus: "not_found" });
    for (const t of ["a", "b", "c"]) expect(by[T(t)]!.lastFetchAt!.getTime()).toBe(NOW.getTime());
    // Los deshabilitados y los de otro proveedor no se tocan
    expect(by[T("off")]).toMatchObject({ lastFetchAt: null, lastStatus: null });
    expect(by[T("otro")]).toMatchObject({ lastFetchAt: null, lastStatus: null });
  });
});
