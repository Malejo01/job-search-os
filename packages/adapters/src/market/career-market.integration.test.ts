import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { buildCareerMarket } from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readCareerMarketInput } from "./career-market";

/**
 * Ronda 58 · Lectura del mercado por carrera: solo avisos del rol, sin copias y dentro de la
 * ventana de 30 días; las skills son las de esos avisos. Datos inventados.
 */
const PREFIX = "careermkt-test-";
const NOW = new Date("2026-10-14T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const skillIds: Record<string, string> = {};
let seq = 0;

async function pool(
  roleHints: string[],
  skills: { slug: string; isMust: boolean }[],
  over: Partial<typeof s.publicJobs.$inferInsert> = {},
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
      roleHints,
      postedAt: day(2),
      firstSeenAt: day(2),
      lastSeenAt: NOW,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  if (skills.length) {
    await conn.db.insert(s.publicJobSkills).values(
      skills.map((k) => ({
        publicJobId: row!.id,
        skillId: skillIds[k.slug]!,
        isMust: k.isMust,
      })),
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
  for (const slug of ["careermkt_s1", "careermkt_s2", "careermkt_s3"]) {
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

describe("readCareerMarketInput", () => {
  it("trae solo los avisos del rol, sin copias y dentro de la ventana", async () => {
    const root = await pool(["qa"], [{ slug: "careermkt_s1", isMust: true }]);
    await pool(["qa", "soporte_it"], [{ slug: "careermkt_s1", isMust: false }]);
    await pool(["ux_ui"], [{ slug: "careermkt_s2", isMust: true }]); // otro rol
    await pool(["qa"], [{ slug: "careermkt_s3", isMust: true }], { dedupOfId: root }); // copia
    await pool(["qa"], [{ slug: "careermkt_s3", isMust: true }], { lastSeenAt: day(40) }); // viejo

    const input = await readCareerMarketInput(conn.db, "qa", NOW);
    expect(input.role).toBe("qa");
    expect(input.now).toBe(NOW.toISOString());
    expect(input.jobs).toHaveLength(2);
    expect(input.jobs.every((j) => j.publishedAt === day(2).toISOString())).toBe(true);
    expect(input.skills.map((k) => k.slug)).toEqual(["careermkt_s1", "careermkt_s1"]);
    expect(input.skills.every((k) => input.jobs.some((j) => j.id === k.jobId))).toBe(true);
    // El último visto es del pool entero, no solo del rol
    expect(input.poolUpdatedAt).toBe(NOW.toISOString());
  });

  it("sin fecha de publicación, publishedAt sale de first_seen_at", async () => {
    await pool(["qa"], [], { postedAt: null, firstSeenAt: day(3) });
    const input = await readCareerMarketInput(conn.db, "qa", NOW);
    expect(input.jobs[0]?.publishedAt).toBe(day(3).toISOString());
  });

  it("corta el texto del aviso en 30 000 caracteres", async () => {
    await pool(["qa"], [], { jdText: "a".repeat(31000) });
    await pool(["qa"], [], { jdText: null });
    const input = await readCareerMarketInput(conn.db, "qa", NOW);
    const lengths = input.jobs.map((j) => j.jdText?.length ?? null).sort();
    expect(lengths).toEqual([30000, null]);
  });

  it("un rol sin avisos devuelve listas vacías", async () => {
    await pool(["qa"], []);
    const input = await readCareerMarketInput(conn.db, "backend", NOW);
    expect(input.jobs).toEqual([]);
    expect(input.skills).toEqual([]);
  });

  it("buildCareerMarket sobre esa entrada da los totales esperados", async () => {
    await pool(["qa"], [{ slug: "careermkt_s1", isMust: true }], {
      salaryMinUsd: 1000,
      salaryMaxUsd: 2000,
      salaryPeriod: "mensual",
    });
    await pool(["qa"], [{ slug: "careermkt_s1", isMust: false }], { postedAt: day(0) });
    await pool(["qa"], [{ slug: "careermkt_s2", isMust: false }]);
    await pool(["ux_ui"], [{ slug: "careermkt_s1", isMust: true }]);

    const market = buildCareerMarket(await readCareerMarketInput(conn.db, "qa", NOW));
    expect(market.total).toBe(3);
    expect(market.smallSample).toBe(true);
    expect(market.volume.active).toBe(3);
    expect(market.volume.new24h).toBe(1);
    expect(market.salary).toMatchObject({ informed: 1, total: 3, enough: false });
    expect(market.skills[0]).toMatchObject({ slug: "careermkt_s1", jobs: 2, must: 1, nice: 1 });
  });
});
