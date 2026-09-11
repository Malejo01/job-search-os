import { schema as s } from "@job-search-os/db";
import { buildAgenda, type MarketAgenda } from "@job-search-os/pipeline";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Agenda de mercado (/market, adelanto de JS-031): lee el snapshot más reciente dentro del rango
 * de semanas pedido y lo cruza con skill_levels del usuario. Sin LLM; buildAgenda es pura.
 */
export type MarketView = {
  weekStart: string | null;
  weeks: string[];
  agenda: MarketAgenda;
  skills: Record<string, { name: string; category: string; closureHours: number | null }>;
  levelsKnown: number;
};

export type MarketRange = { from: string | null; to: string | null };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function parseRange(params: Record<string, string | string[] | undefined>): MarketRange {
  const one = (k: string) => {
    const v = params[k];
    const x = (Array.isArray(v) ? v[0] : v) ?? "";
    return DATE_RE.test(x) ? x : null;
  };
  return { from: one("desde"), to: one("hasta") };
}

export async function getMarket(userId: string, range: MarketRange): Promise<MarketView> {
  return withUser(userId, async (tx) => {
    const weekRows = await tx
      .selectDistinct({ weekStart: s.marketSnapshots.weekStart })
      .from(s.marketSnapshots)
      .orderBy(desc(s.marketSnapshots.weekStart));
    const weeks = weekRows.map((w) => w.weekStart);
    const conds = [
      range.from ? gte(s.marketSnapshots.weekStart, range.from) : undefined,
      range.to ? lte(s.marketSnapshots.weekStart, range.to) : undefined,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);
    const [latest] = await tx
      .select({ weekStart: s.marketSnapshots.weekStart })
      .from(s.marketSnapshots)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(s.marketSnapshots.weekStart))
      .limit(1);
    const weekStart = latest?.weekStart ?? null;

    const levelRows = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId));
    const skillRows = await tx
      .select({
        slug: s.skills.slug,
        name: s.skills.name,
        category: s.skills.category,
        closureHours: s.skills.closureHours,
      })
      .from(s.skills);
    const skills = Object.fromEntries(
      skillRows.map((k) => [
        k.slug,
        { name: k.name, category: k.category, closureHours: k.closureHours },
      ]),
    );

    if (!weekStart) {
      return {
        weekStart,
        weeks,
        agenda: buildAgenda([], levelRows),
        skills,
        levelsKnown: levelRows.length,
      };
    }
    const rows = await tx
      .select({
        slug: s.skills.slug,
        mentions: s.marketSnapshots.mentions,
        mustMentions: s.marketSnapshots.mustMentions,
        weightedDemand: s.marketSnapshots.weightedDemand,
      })
      .from(s.marketSnapshots)
      .innerJoin(s.skills, eq(s.skills.id, s.marketSnapshots.skillId))
      .where(eq(s.marketSnapshots.weekStart, weekStart))
      .orderBy(desc(s.marketSnapshots.weightedDemand));
    return {
      weekStart,
      weeks,
      agenda: buildAgenda(rows, levelRows),
      skills,
      levelsKnown: levelRows.length,
    };
  });
}
