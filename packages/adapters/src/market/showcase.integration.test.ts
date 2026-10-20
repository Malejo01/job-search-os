import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { SHOWCASE_SOURCES } from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readPoolShowcaseInput, readShowcaseJobs } from "./showcase";

/**
 * Ronda 63 · Lecturas de la vitrina pública: avisos activos (sin copias, vistos en 7 días), fuentes
 * excluidas, filtro por carrera, orden por fecha y skills por aviso. Datos inventados.
 */
const PREFIX = "showcase-test-";
const NOW = new Date("2026-10-20T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const skillIds: Record<string, string> = {};
let seq = 0;

async function pool(
  over: Partial<typeof s.publicJobs.$inferInsert> = {},
  skills: { slug: string; isMust: boolean }[] = [],
) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: `Puesto ficticio ${n}`,
      titleNormalized: `puesto ficticio ${n}`,
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      roleHints: ["qa"],
      postedAt: day(2),
      firstSeenAt: day(2),
      lastSeenAt: NOW,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  if (skills.length) {
    await conn.db
      .insert(s.publicJobSkills)
      .values(
        skills.map((k) => ({ publicJobId: row!.id, skillId: skillIds[k.slug]!, isMust: k.isMust })),
      );
  }
  return row!.id;
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
  for (const slug of ["showcase_s1", "showcase_s2"]) {
    const [k] = await conn.db
      .insert(s.skills)
      .values({ slug, name: `Skill ${slug}`, category: "otra" })
      .onConflictDoUpdate({ target: s.skills.slug, set: { name: `Skill ${slug}` } })
      .returning({ id: s.skills.id });
    skillIds[slug] = k!.id;
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
});

describe("readPoolShowcaseInput", () => {
  it("trae solo avisos activos: sin copias, vistos en 7 días y de fuentes permitidas", async () => {
    const original = await pool({ roleHints: ["qa"] });
    await pool({ dedupOfId: original });
    await pool({ lastSeenAt: day(8) });
    await pool({ lastSeenAt: day(6), sourceKind: "jobicy", sourceName: "Jobicy" });
    await pool({ sourceKind: "wwr", sourceName: "We Work Remotely" });
    await pool({ sourceKind: "himalayas", sourceName: "Himalayas" });

    const all = await readPoolShowcaseInput(conn.db, NOW, SHOWCASE_SOURCES);
    const mine = all.jobs.filter((j) => j.companyRaw.startsWith("Empresa Ficticia"));
    expect(mine).toHaveLength(2);
    expect(mine.map((j) => j.sourceKind).sort()).toEqual(["jobicy", "remoteok"]);

    const soloJobicy = await readPoolShowcaseInput(conn.db, NOW, ["jobicy"]);
    const rest = soloJobicy.jobs.filter((j) => j.companyRaw.startsWith("Empresa Ficticia"));
    expect(rest).toHaveLength(1);
    expect((await readPoolShowcaseInput(conn.db, NOW, [])).jobs).toEqual([]);
    expect(all.now).toBe(NOW.toISOString());
    expect(all.poolUpdatedAt).not.toBeNull();
  });

  it("no trae descripción ni datos de usuarios", async () => {
    await pool({ jdText: "texto largo del aviso" });
    const { jobs } = await readPoolShowcaseInput(conn.db, NOW, SHOWCASE_SOURCES);
    expect(Object.keys(jobs[0]!).sort()).toEqual([
      "companyRaw",
      "countriesAllowed",
      "firstSeenAt",
      "locationRaw",
      "modality",
      "roleHints",
      "sourceKind",
    ]);
  });
});

describe("readShowcaseJobs", () => {
  it("ordena por fecha, respeta el tope y trae las skills de cada aviso", async () => {
    const old = await pool({ postedAt: day(5) });
    const recent = await pool({ postedAt: day(1) }, [
      { slug: "showcase_s1", isMust: false },
      { slug: "showcase_s2", isMust: true },
    ]);
    await pool({ postedAt: day(3) });

    const rows = await readShowcaseJobs(conn.db, { limit: 2000, sources: SHOWCASE_SOURCES }, NOW);
    const mine = rows.filter((r) => r.companyRaw.startsWith("Empresa Ficticia"));
    expect(mine.map((r) => r.id)).toHaveLength(3);
    expect(mine[0]!.id).toBe(recent);
    expect(mine[2]!.id).toBe(old);
    expect(mine[0]!.skills.map((k) => k.name).sort()).toEqual([
      "Skill showcase_s1",
      "Skill showcase_s2",
    ]);
    expect(Object.keys(mine[0]!)).not.toContain("jdText");
    expect(
      await readShowcaseJobs(conn.db, { limit: 2, sources: SHOWCASE_SOURCES }, NOW),
    ).toHaveLength(2);
  });

  it("filtra por carrera; excluye copias, avisos de más de 72 h y fuentes no permitidas", async () => {
    const qa = await pool({ roleHints: ["qa"] });
    await pool({ roleHints: ["frontend"] });
    await pool({ roleHints: ["qa"], lastSeenAt: day(4) });
    await pool({ roleHints: ["qa"], sourceKind: "wwr", sourceName: "We Work Remotely" });
    await pool({ roleHints: ["qa"], sourceKind: "himalayas", sourceName: "Himalayas" });
    await pool({ roleHints: ["qa"], dedupOfId: qa });
    const fresh = await pool({ roleHints: ["qa"], lastSeenAt: day(2) });

    const rows = await readShowcaseJobs(
      conn.db,
      { role: "qa", limit: 50, sources: SHOWCASE_SOURCES },
      NOW,
    );
    const ids = rows.filter((r) => r.companyRaw.startsWith("Empresa Ficticia")).map((r) => r.id);
    expect(ids.sort()).toEqual([qa, fresh].sort());
  });

  it("un aviso con fecha futura no queda por encima de uno de hoy", async () => {
    const today = await pool({ postedAt: day(0) });
    await pool({ postedAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000) });
    const rows = await readShowcaseJobs(conn.db, { limit: 5, sources: SHOWCASE_SOURCES }, NOW);
    expect(rows.map((r) => r.id)).toContain(today);
  });

  it("limit 0 no trae nada", async () => {
    await pool();
    expect(await readShowcaseJobs(conn.db, { limit: 0, sources: SHOWCASE_SOURCES }, NOW)).toEqual(
      [],
    );
  });
});
