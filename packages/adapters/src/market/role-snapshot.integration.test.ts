import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { weekStartOf } from "@job-search-os/pipeline";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildRoleMarketSnapshots, getRoleMarket } from "./role-snapshot";

/**
 * Ronda 38 · Mercado por rol desde el pool: por rol, sin copias ni avisos viejos, y la semana se
 * reemplaza entera. Datos inventados.
 */
const PREFIX = "rolemkt-test-";
const NOW = new Date("2026-10-14T12:00:00Z"); // miércoles
const WEEK = weekStartOf(NOW); // 2026-10-12
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
      title: "Puesto ficticio",
      titleNormalized: "puesto ficticio",
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

async function rowsOf(role: string, weekStart = WEEK) {
  const rows = await conn.db
    .select({
      slug: s.skills.slug,
      mentions: s.roleMarketSnapshots.mentions,
      mustMentions: s.roleMarketSnapshots.mustMentions,
      jobs: s.roleMarketSnapshots.jobs,
    })
    .from(s.roleMarketSnapshots)
    .innerJoin(s.skills, eq(s.skills.id, s.roleMarketSnapshots.skillId))
    .where(
      and(eq(s.roleMarketSnapshots.role, role), eq(s.roleMarketSnapshots.weekStart, weekStart)),
    );
  return rows.sort((a, b) => a.slug.localeCompare(b.slug));
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
  for (const slug of ["rolemkt_s1", "rolemkt_s2", "rolemkt_s3"]) {
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
  await conn.db.delete(s.roleMarketSnapshots);
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
});

describe("buildRoleMarketSnapshots", () => {
  it("agrega por rol, con menciones, obligatorias y cantidad de avisos", async () => {
    await pool(["qa"], [{ slug: "rolemkt_s1", isMust: true }]);
    await pool(
      ["qa", "soporte_it"],
      [
        { slug: "rolemkt_s1", isMust: false },
        { slug: "rolemkt_s2", isMust: false },
      ],
    );
    await pool(["ux_ui"], [{ slug: "rolemkt_s1", isMust: true }]);
    await pool([], [{ slug: "rolemkt_s3", isMust: true }]); // sin señal de rol: no cuenta en ninguno

    const r = await buildRoleMarketSnapshots(conn.db, { now: NOW });
    expect(r).toEqual({ weekStart: WEEK, roles: 3, rows: 2 + 2 + 1 });

    expect(await rowsOf("qa")).toEqual([
      { slug: "rolemkt_s1", mentions: 2, mustMentions: 1, jobs: 2 },
      { slug: "rolemkt_s2", mentions: 1, mustMentions: 0, jobs: 2 },
    ]);
    expect(await rowsOf("ux_ui")).toEqual([
      { slug: "rolemkt_s1", mentions: 1, mustMentions: 1, jobs: 1 },
    ]);
    expect(await rowsOf("soporte_it")).toHaveLength(2);
    expect(await rowsOf("backend")).toEqual([]);
  });

  it("no cuenta copias ni avisos de más de 30 días", async () => {
    const root = await pool(["qa"], [{ slug: "rolemkt_s1", isMust: true }]);
    await pool(["qa"], [{ slug: "rolemkt_s3", isMust: true }], { dedupOfId: root });
    await pool(["qa"], [{ slug: "rolemkt_s3", isMust: true }], {
      postedAt: day(40),
      firstSeenAt: day(40),
    });
    // Sin fecha de publicación cuenta por first_seen_at
    await pool(["qa"], [{ slug: "rolemkt_s2", isMust: false }], {
      postedAt: null,
      firstSeenAt: day(3),
    });

    await buildRoleMarketSnapshots(conn.db, { now: NOW });
    expect(await rowsOf("qa")).toEqual([
      { slug: "rolemkt_s1", mentions: 1, mustMentions: 1, jobs: 2 },
      { slug: "rolemkt_s2", mentions: 1, mustMentions: 0, jobs: 2 },
    ]);
  });

  it("la semana se reemplaza entera y las otras semanas no se tocan", async () => {
    const old = await pool(["qa"], [{ slug: "rolemkt_s1", isMust: true }]);
    await pool(["ux_ui"], [{ slug: "rolemkt_s2", isMust: true }]);
    await buildRoleMarketSnapshots(conn.db, { now: NOW });
    await conn.db.insert(s.roleMarketSnapshots).values({
      role: "qa",
      weekStart: "2026-10-05",
      skillId: skillIds.rolemkt_s3!,
      mentions: 9,
      mustMentions: 9,
      jobs: 9,
    });

    // Cambia el pool: el aviso de QA se va y el de UX cambia de skill
    await conn.db.delete(s.publicJobs).where(eq(s.publicJobs.id, old));
    await pool(["ux_ui"], [{ slug: "rolemkt_s3", isMust: false }]);
    const again = await buildRoleMarketSnapshots(conn.db, { now: NOW });

    expect(await rowsOf("qa")).toEqual([]);
    expect(await rowsOf("ux_ui")).toEqual([
      { slug: "rolemkt_s2", mentions: 1, mustMentions: 1, jobs: 2 },
      { slug: "rolemkt_s3", mentions: 1, mustMentions: 0, jobs: 2 },
    ]);
    expect(again.rows).toBe(2);
    expect(await rowsOf("qa", "2026-10-05")).toHaveLength(1);
  });

  it("correrla dos veces seguidas da lo mismo", async () => {
    await pool(["qa"], [{ slug: "rolemkt_s1", isMust: true }]);
    const a = await buildRoleMarketSnapshots(conn.db, { now: NOW });
    const b = await buildRoleMarketSnapshots(conn.db, { now: NOW });
    expect(b).toEqual(a);
    expect(await rowsOf("qa")).toHaveLength(1);
  });
});

describe("getRoleMarket", () => {
  it("devuelve la última semana del rol, top por menciones con el nombre de la skill", async () => {
    await pool(["qa"], [{ slug: "rolemkt_s1", isMust: true }]);
    await pool(
      ["qa"],
      [
        { slug: "rolemkt_s1", isMust: false },
        { slug: "rolemkt_s2", isMust: true },
      ],
    );
    await pool(["qa"], [{ slug: "rolemkt_s3", isMust: false }]);
    await buildRoleMarketSnapshots(conn.db, { now: NOW });
    // Una semana anterior no debe ganar
    await conn.db.insert(s.roleMarketSnapshots).values({
      role: "qa",
      weekStart: "2026-10-05",
      skillId: skillIds.rolemkt_s3!,
      mentions: 99,
      mustMentions: 99,
      jobs: 99,
    });

    const all = await getRoleMarket(conn.db, "qa");
    expect(all.weekStart).toBe(WEEK);
    expect(all.jobs).toBe(3);
    expect(all.skills).toEqual([
      { slug: "rolemkt_s1", name: "Skill rolemkt_s1", mentions: 2, mustMentions: 1 },
      { slug: "rolemkt_s2", name: "Skill rolemkt_s2", mentions: 1, mustMentions: 1 },
      { slug: "rolemkt_s3", name: "Skill rolemkt_s3", mentions: 1, mustMentions: 0 },
    ]);

    const top = await getRoleMarket(conn.db, "qa", { limit: 1 });
    expect(top.skills.map((k) => k.slug)).toEqual(["rolemkt_s1"]);
    expect(top.jobs).toBe(3);
  });

  it("un rol sin datos devuelve semana null", async () => {
    expect(await getRoleMarket(conn.db, "backend")).toEqual({
      weekStart: null,
      jobs: 0,
      skills: [],
    });
  });
});
