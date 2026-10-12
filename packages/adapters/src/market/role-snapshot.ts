import { schema as s, type Db } from "@job-search-os/db";
import { ROLE_KEYS, roleDemand, weekStartOf } from "@job-search-os/pipeline";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

/**
 * Mercado por rol (ronda 38): demanda de skills de los avisos del pool, sin datos de usuarios.
 * `buildRoleMarketSnapshots` corre como servicio (cron) y reemplaza la semana entera de
 * `role_market_snapshots`; `getRoleMarket` lee la última semana de un rol (página /market y
 * respaldo del plan de formación).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ventana de avisos que cuentan para el mercado de un rol. */
export const ROLE_MARKET_WINDOW_DAYS = 30;

export async function buildRoleMarketSnapshots(
  db: Db,
  opts: { now?: Date } = {},
): Promise<{ weekStart: string; roles: number; rows: number }> {
  const now = opts.now ?? new Date();
  const weekStart = weekStartOf(now);
  const since = new Date(now.getTime() - ROLE_MARKET_WINDOW_DAYS * DAY_MS);

  const inserts: (typeof s.roleMarketSnapshots.$inferInsert)[] = [];
  let roles = 0;
  for (const role of ROLE_KEYS) {
    // Avisos del rol: sin copias, de los últimos 30 días (sin fecha de publicación, por first_seen_at)
    const roleJobs = and(
      isNull(s.publicJobs.dedupOfId),
      sql`coalesce(${s.publicJobs.postedAt}, ${s.publicJobs.firstSeenAt}) >= ${since.toISOString()}::timestamptz`,
      sql`${s.publicJobs.roleHints} @> ARRAY[${role}]::text[]`,
    );
    const jobRows = await db.select({ id: s.publicJobs.id }).from(s.publicJobs).where(roleJobs);
    if (!jobRows.length) continue;
    roles++;

    const skillRows = await db
      .select({
        publicJobId: s.publicJobSkills.publicJobId,
        skillId: s.skills.id,
        slug: s.skills.slug,
        isMust: s.publicJobSkills.isMust,
      })
      .from(s.publicJobSkills)
      .innerJoin(s.publicJobs, eq(s.publicJobs.id, s.publicJobSkills.publicJobId))
      .innerJoin(s.skills, eq(s.skills.id, s.publicJobSkills.skillId))
      .where(roleJobs);

    const byJob = new Map<string, { slug: string; isMust: boolean }[]>();
    for (const r of skillRows) {
      byJob.set(r.publicJobId, [
        ...(byJob.get(r.publicJobId) ?? []),
        { slug: r.slug, isMust: r.isMust },
      ]);
    }
    const skillIdBySlug = new Map(skillRows.map((r) => [r.slug, r.skillId]));
    const demand = roleDemand(jobRows.map((j) => ({ skills: byJob.get(j.id) ?? [] })));
    for (const d of demand) {
      inserts.push({
        role,
        weekStart,
        skillId: skillIdBySlug.get(d.slug)!,
        mentions: d.mentions,
        mustMentions: d.mustMentions,
        jobs: jobRows.length,
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(s.roleMarketSnapshots).where(eq(s.roleMarketSnapshots.weekStart, weekStart));
    // Por tandas: un insert con miles de filas supera el máximo de parámetros
    for (let i = 0; i < inserts.length; i += 1000) {
      await tx.insert(s.roleMarketSnapshots).values(inserts.slice(i, i + 1000));
    }
  });

  return { weekStart, roles, rows: inserts.length };
}

export type RoleMarket = {
  weekStart: string | null;
  jobs: number;
  skills: { slug: string; name: string; mentions: number; mustMentions: number }[];
};

export async function getRoleMarket(
  db: Db,
  role: string,
  opts: { limit?: number } = {},
): Promise<RoleMarket> {
  const limit = Math.max(0, Math.floor(opts.limit ?? 10));
  const [latest] = await db
    .select({ weekStart: s.roleMarketSnapshots.weekStart })
    .from(s.roleMarketSnapshots)
    .where(eq(s.roleMarketSnapshots.role, role))
    .orderBy(desc(s.roleMarketSnapshots.weekStart))
    .limit(1);
  if (!latest) return { weekStart: null, jobs: 0, skills: [] };

  const week = and(
    eq(s.roleMarketSnapshots.role, role),
    eq(s.roleMarketSnapshots.weekStart, latest.weekStart),
  );
  const [total] = await db
    .select({ jobs: sql<number>`coalesce(max(${s.roleMarketSnapshots.jobs}), 0)::int` })
    .from(s.roleMarketSnapshots)
    .where(week);
  const skills = limit
    ? await db
        .select({
          slug: s.skills.slug,
          name: s.skills.name,
          mentions: s.roleMarketSnapshots.mentions,
          mustMentions: s.roleMarketSnapshots.mustMentions,
        })
        .from(s.roleMarketSnapshots)
        .innerJoin(s.skills, eq(s.skills.id, s.roleMarketSnapshots.skillId))
        .where(week)
        .orderBy(
          desc(s.roleMarketSnapshots.mentions),
          desc(s.roleMarketSnapshots.mustMentions),
          s.skills.slug,
        )
        .limit(limit)
    : [];
  return { weekStart: latest.weekStart, jobs: total?.jobs ?? 0, skills };
}
