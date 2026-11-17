import { getRoleMarket } from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import {
  CV_REVIEW_ITEM_KINDS,
  cvCoachBeforeSchema,
  type CvCoachBefore,
  type CvReviewContext,
  type CvCoachItem,
  type CvReviewItem,
  type SkillDemand,
  cvSectionOfKind,
} from "@job-search-os/pipeline";
import { asc, eq, gte, and } from "drizzle-orm";
import { catalogLabel } from "@/lib/career-names";
import { withUser } from "@/lib/db";
import { getTargetRoles } from "@/lib/onboarding";

/**
 * Lo que el coach de CV lee de la base (ADR-038 §4 y §8), todo con `withUser` (RLS) y filtrando por la
 * persona: lo confirmado en `career_history`, las skills con nivel, el puesto objetivo (el primero del perfil)
 * y la demanda del mercado de ese puesto (`role_market_snapshots`, sin datos de usuarios). Nada viene del
 * navegador: el diagnóstico y los turnos se arman siempre con lo que está en la base.
 */

/** Skills del mercado que se traen para las brechas (las más pedidas primero). */
const MARKET_SKILLS = 20;
/** Una skill cuenta como «de la persona» con nivel 1 o más. */
const MIN_LEVEL = 1;

export type CvCoachContext = {
  ctx: CvReviewContext;
  /** Clave del puesto objetivo (`null` si la persona no eligió ninguno). */
  role: string | null;
};

const isKind = (k: string): k is CvReviewItem["kind"] =>
  (CV_REVIEW_ITEM_KINDS as readonly string[]).includes(k);

export async function loadCvCoachContext(userId: string): Promise<CvCoachContext> {
  const roles = await getTargetRoles(userId);
  const role = roles[0] ?? null;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort), asc(s.careerHistory.createdAt));
    const items: CvReviewItem[] = rows.flatMap((r) =>
      isKind(r.kind)
        ? [
            {
              id: r.id,
              kind: r.kind,
              organization: r.organization,
              title: r.title,
              startMonth: r.startMonth,
              endMonth: r.endMonth,
              bullets: r.bullets,
              // La columna `link` llega con R12-4 (proyectos): hasta entonces, sin link
              link: (r as { link?: string | null }).link ?? null,
            },
          ]
        : [],
    );
    const levels = await tx
      .select({ slug: s.skills.slug })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(and(eq(s.skillLevels.userId, userId), gte(s.skillLevels.level, MIN_LEVEL)));
    const taxonomy = await tx
      .select({ slug: s.skills.slug, name: s.skills.name, aliases: s.skills.aliases })
      .from(s.skills)
      .limit(3000);
    const market = role ? await getRoleMarket(tx, role, { limit: MARKET_SKILLS }) : null;
    // `getRoleMarket` ya viene ordenado por menciones: es el ranking de la demanda del pool
    const demand: SkillDemand[] = (market?.skills ?? []).map((m) => ({
      slug: m.slug,
      mentions: m.mentions,
      mustMentions: m.mustMentions,
      weightedDemand: m.mentions,
    }));
    return {
      role,
      ctx: {
        target: role ? catalogLabel(role) : "tu próximo trabajo",
        items,
        personSkills: levels.map((l) => l.slug),
        taxonomy,
        demand,
        // El resumen del CV no está en la base (lo redacta `cv_write`): sin resumen no hay `resumen_generico`
        summary: null,
      },
    };
  });
}

/**
 * Foto «antes» para «Qué mejoró» (ADR-038 §8): las filas confirmadas al empezar el coach, con el mismo
 * esquema que valida el navegador. Lo que no entra en el esquema (más de 40 ítems, más de 6 viñetas) se
 * recorta: la foto es para comparar, no para escribir.
 */
export function cvCoachBefore(
  flowId: string,
  items: readonly CvReviewItem[],
): CvCoachBefore | null {
  const parsed = cvCoachBeforeSchema.safeParse({
    flowId,
    items: items.slice(0, 40).map((i) => ({
      historyId: i.id,
      kind: i.kind,
      organization: i.organization,
      title: i.title,
      bullets: i.bullets.slice(0, 6),
    })),
  });
  return parsed.success ? parsed.data : null;
}

/** Los ítems con la forma que usa el turno (R12-9): sección por tipo y «sigue ahí» si no tiene fin. */
export function cvCoachItems(items: readonly CvReviewItem[]): CvCoachItem[] {
  return items.map((i) => ({
    id: i.id,
    section: cvSectionOfKind(i.kind) as CvCoachItem["section"],
    organization: i.organization,
    title: i.title,
    startMonth: i.startMonth,
    endMonth: i.endMonth,
    isCurrent: i.startMonth !== null && i.endMonth === null,
    bullets: i.bullets,
    link: i.link,
  }));
}

/** `slug` → nombre de la taxonomía, solo para las skills que nombran los problemas. */
export function cvCoachSkillNames(
  ctx: CvReviewContext,
  slugs: readonly (string | null)[],
): Record<string, string> {
  const wanted = new Set(slugs.filter((x): x is string => x !== null));
  const out: Record<string, string> = {};
  for (const t of ctx.taxonomy) if (wanted.has(t.slug)) out[t.slug] = t.name;
  return out;
}

/** `slug` → alias de la taxonomía, para no repreguntar una skill que la persona nombró de otra forma. */
export function cvCoachSkillAliases(
  ctx: CvReviewContext,
  slugs: readonly (string | null)[],
): Record<string, readonly string[]> {
  const wanted = new Set(slugs.filter((x): x is string => x !== null));
  const out: Record<string, readonly string[]> = {};
  for (const t of ctx.taxonomy) if (wanted.has(t.slug)) out[t.slug] = [...(t.aliases ?? [])];
  return out;
}
