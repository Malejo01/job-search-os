import { schema as s } from "@job-search-os/db";
import roleSkillsSeed from "@job-search-os/db/seeds/role_skills.json";
import {
  roleSkillsSchema,
  type RoleSkillsMap,
  type SkillLevelEntry,
} from "@job-search-os/pipeline";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withUser } from "./db";

/** Mapa rol → skills sugeridas (seed versionado), validado al cargar. */
export const ROLE_SKILLS: RoleSkillsMap = roleSkillsSchema.parse(roleSkillsSeed);

/**
 * Skills autodeclaradas (ronda 28): lectura y escritura de `skill_levels` del usuario. Todo dentro
 * de `withUser`; la taxonomía (`skills`) es de lectura global.
 */

export type TaxonomySkill = { slug: string; name: string; category: string; aliases: string[] };

export type SkillsPageData = {
  taxonomy: TaxonomySkill[];
  /** slug → nivel declarado (0..3) */
  levels: Record<string, number>;
  headline: string | null;
  allowedDisciplines: string[];
};

export async function getSkillsPageData(userId: string): Promise<SkillsPageData> {
  return withUser(userId, async (tx) => {
    const taxonomy = await tx
      .select({
        slug: s.skills.slug,
        name: s.skills.name,
        category: s.skills.category,
        aliases: s.skills.aliases,
      })
      .from(s.skills)
      .orderBy(s.skills.name);
    const rows = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId));
    const [profile] = await tx
      .select({ headline: s.profiles.headline })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const [criteria] = await tx
      .select({ rules: s.evaluationCriteria.rules })
      .from(s.evaluationCriteria)
      .where(and(eq(s.evaluationCriteria.userId, userId), eq(s.evaluationCriteria.active, true)))
      .limit(1);
    const allowed = criteria?.rules?.allowed_disciplines;
    return {
      taxonomy,
      levels: Object.fromEntries(rows.map((r) => [r.slug, r.level])),
      headline: profile?.headline ?? null,
      allowedDisciplines: Array.isArray(allowed) ? allowed.map(String) : [],
    };
  });
}

/**
 * Guarda los niveles y quita los pedidos. Alta: confianza 0.5 y estado `sin_evidencia`;
 * actualización: cambia `level` y `updated_at` y conserva confianza y estado (pueden venir de la
 * evidencia); si el nivel es el mismo no toca la fila. Un slug que no está en `skills` se ignora.
 * `changed` cuenta altas, niveles distintos y filas quitadas: es lo que decide si hay que recalcular.
 */
export async function saveSkillLevels(
  userId: string,
  entries: SkillLevelEntry[],
  removeSlugs: string[] = [],
): Promise<{ changed: number }> {
  return withUser(userId, async (tx) => {
    const slugs = [...new Set([...entries.map((e) => e.slug), ...removeSlugs])];
    if (slugs.length === 0) return { changed: 0 };
    const known = await tx
      .select({ id: s.skills.id, slug: s.skills.slug })
      .from(s.skills)
      .where(inArray(s.skills.slug, slugs));
    const idOf = new Map(known.map((k) => [k.slug, k.id]));

    const removeIds = removeSlugs.flatMap((slug) => idOf.get(slug) ?? []);
    let changed = 0;
    if (removeIds.length > 0) {
      const gone = await tx
        .delete(s.skillLevels)
        .where(and(eq(s.skillLevels.userId, userId), inArray(s.skillLevels.skillId, removeIds)))
        .returning({ skillId: s.skillLevels.skillId });
      changed += gone.length;
    }

    const removed = new Set(removeSlugs);
    const values = entries.flatMap((e) => {
      const skillId = idOf.get(e.slug);
      // Si la misma skill vino para quitar, gana "Quitar"
      if (!skillId || removed.has(e.slug)) return [];
      return [
        { userId, skillId, level: e.level, confidence: 0.5, state: "sin_evidencia" as const },
      ];
    });
    if (values.length === 0) return { changed };
    // Con el mismo nivel el update no corre y la fila no vuelve en returning
    const written = await tx
      .insert(s.skillLevels)
      .values(values)
      .onConflictDoUpdate({
        target: [s.skillLevels.userId, s.skillLevels.skillId],
        set: { level: sql`excluded.level`, updatedAt: sql`now()` },
        setWhere: sql`${s.skillLevels.level} <> excluded.level`,
      })
      .returning({ skillId: s.skillLevels.skillId });
    return { changed: changed + written.length };
  });
}
