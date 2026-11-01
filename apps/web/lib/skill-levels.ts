import { schema as s } from "@job-search-os/db";
import roleSkillsSeed from "@job-search-os/db/seeds/role_skills.json";
import {
  ENGLISH_SKILL_SLUGS,
  MAX_CUSTOM_SKILLS,
  roleSkillsSchema,
  skillLevelsFromCefr,
  type CefrLevel,
  type RoleSkillsMap,
  type SkillLevelEntry,
} from "@job-search-os/pipeline";
import { and, eq, inArray, sql } from "drizzle-orm";
import { withUser, type Tx } from "./db";
import { getSkillTaxonomy } from "./skill-taxonomy";

/** Mapa rol → skills sugeridas (seed versionado), validado al cargar. */
export const ROLE_SKILLS: RoleSkillsMap = roleSkillsSchema.parse(roleSkillsSeed);

/**
 * Skills autodeclaradas (ronda 28): lectura y escritura de `skill_levels` del usuario. Todo dentro
 * de `withUser`; la taxonomía (`skills`) es de lectura global.
 */

export type TaxonomySkill = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  /** Una frase de qué es y para qué se usa; null si todavía no tiene. */
  description: string | null;
};

/** Skill agregada a mano (`user_skills`): solo de la persona, no entra a la taxonomía ni a ningún prompt. */
export type CustomSkill = { id: string; name: string; level: number };

export type SkillsPageData = {
  taxonomy: TaxonomySkill[];
  /** slug → nivel declarado (0..3) */
  levels: Record<string, number>;
  customSkills: CustomSkill[];
  /** Nivel de inglés del perfil (A1..C2), o null si no lo cargó. */
  englishCefr: string | null;
  headline: string | null;
  allowedDisciplines: string[];
};

export async function getSkillsPageData(userId: string): Promise<SkillsPageData> {
  // Catálogo global con caché de una hora (C5-7): fuera de la transacción de la persona
  const taxonomy: TaxonomySkill[] = (await getSkillTaxonomy()).map((k) => ({
    slug: k.slug,
    name: k.name,
    category: k.category,
    aliases: k.aliases,
    description: k.description,
  }));
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId));
    const customSkills = await tx
      .select({ id: s.userSkills.id, name: s.userSkills.name, level: s.userSkills.level })
      .from(s.userSkills)
      .where(eq(s.userSkills.userId, userId))
      .orderBy(s.userSkills.createdAt);
    const [profile] = await tx
      .select({ headline: s.profiles.headline, englishCefr: s.profiles.englishCefr })
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
      customSkills,
      englishCefr: profile?.englishCefr ?? null,
      headline: profile?.headline ?? null,
      allowedDisciplines: Array.isArray(allowed) ? allowed.map(String) : [],
    };
  });
}

/**
 * Lo que necesita guardar el formulario de skills: la taxonomía (nombres y alias) y las skills
 * propias ya guardadas, para validar las nuevas; y el inglés actual (CEFR del perfil y niveles de las
 * dos skills de inglés), para saber si hay que derivarlos.
 */
export async function getSkillsSaveContext(userId: string): Promise<{
  taxonomy: { slug: string; name: string; aliases: string[] }[];
  existing: { id: string; name: string }[];
  englishCefr: string | null;
  englishLevels: Record<string, number>;
}> {
  const taxonomy = (await getSkillTaxonomy()).map((k) => ({
    slug: k.slug,
    name: k.name,
    aliases: k.aliases,
  }));
  return withUser(userId, async (tx) => {
    const existing = await tx
      .select({ id: s.userSkills.id, name: s.userSkills.name })
      .from(s.userSkills)
      .where(eq(s.userSkills.userId, userId));
    const [profile] = await tx
      .select({ englishCefr: s.profiles.englishCefr })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    const english = await tx
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(
        and(eq(s.skillLevels.userId, userId), inArray(s.skills.slug, [...ENGLISH_SKILL_SLUGS])),
      );
    return {
      taxonomy,
      existing,
      englishCefr: profile?.englishCefr ?? null,
      englishLevels: Object.fromEntries(english.map((r) => [r.slug, r.level])),
    };
  });
}

/** Lo que muestra el modal de nivel de una skill (C-20): nombre, «¿Qué es?» y nivel ya cargado. */
export type SkillInfo = { name: string; description: string | null; level: number | null };

/** Nombre, descripción y nivel actual de la persona para unos pocos slugs; el resto no aparece. */
export async function skillInfoIn(
  tx: Tx,
  userId: string,
  slugs: readonly string[],
): Promise<Record<string, SkillInfo>> {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) return {};
  const rows = await tx
    .select({
      slug: s.skills.slug,
      name: s.skills.name,
      description: s.skills.description,
      level: s.skillLevels.level,
    })
    .from(s.skills)
    .leftJoin(
      s.skillLevels,
      and(eq(s.skillLevels.skillId, s.skills.id), eq(s.skillLevels.userId, userId)),
    )
    .where(inArray(s.skills.slug, unique));
  return Object.fromEntries(
    rows.map((r) => [r.slug, { name: r.name, description: r.description, level: r.level }]),
  );
}

/** Niveles de `english_intermediate` y `english_fluent` para un nivel CEFR, listos para `saveSkillLevels`. */
export function englishSkillEntries(cefr: CefrLevel): SkillLevelEntry[] {
  const levels = skillLevelsFromCefr(cefr);
  return ENGLISH_SKILL_SLUGS.map((slug) => ({ slug, level: levels[slug] }));
}

/** Guarda `profiles.english_cefr` (ronda 78); si ya tiene ese valor no toca la fila. */
export async function saveEnglishCefr(userId: string, cefr: CefrLevel): Promise<void> {
  await withUser(userId, (tx) =>
    tx
      .update(s.profiles)
      .set({ englishCefr: cefr, updatedAt: sql`now()` })
      .where(
        and(eq(s.profiles.userId, userId), sql`${s.profiles.englishCefr} is distinct from ${cefr}`),
      ),
  );
}

/**
 * Skills propias (`user_skills`), ronda 78: altas, cambios de nivel y bajas en una transacción.
 * NO tocan la taxonomía global ni ningún prompt: son solo de la persona y se muestran con su nivel.
 * El nombre ya viene validado por `parseCustomSkillsForm`; el índice único `(user_id, lower(name))`
 * frena un duplicado por carrera (ese alta se descarta sin error). El tope de 30 se recuenta acá
 * adentro, con un lock por persona, para que dos envíos a la vez no lo pasen: si se pasa devuelve
 * `capExceeded` y no escribe nada. Devuelve cuántas filas cambiaron.
 */
export async function saveCustomSkills(
  userId: string,
  input: {
    updates: { id: string; level: number }[];
    additions: { name: string; level: number }[];
    removeIds: string[];
  },
): Promise<{ changed: number; capExceeded: boolean }> {
  return withUser(userId, async (tx) => {
    let changed = 0;
    if (input.additions.length > 0) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}::text))`);
      const rows = await tx
        .select({ id: s.userSkills.id })
        .from(s.userSkills)
        .where(eq(s.userSkills.userId, userId));
      const removing = new Set(input.removeIds);
      const kept = rows.filter((r) => !removing.has(r.id)).length;
      if (kept + input.additions.length > MAX_CUSTOM_SKILLS) {
        return { changed: 0, capExceeded: true };
      }
    }
    if (input.removeIds.length > 0) {
      const gone = await tx
        .delete(s.userSkills)
        .where(and(eq(s.userSkills.userId, userId), inArray(s.userSkills.id, input.removeIds)))
        .returning({ id: s.userSkills.id });
      changed += gone.length;
    }
    for (const u of input.updates) {
      const done = await tx
        .update(s.userSkills)
        .set({ level: u.level })
        .where(
          and(
            eq(s.userSkills.userId, userId),
            eq(s.userSkills.id, u.id),
            sql`${s.userSkills.level} <> ${u.level}`,
          ),
        )
        .returning({ id: s.userSkills.id });
      changed += done.length;
    }
    if (input.additions.length > 0) {
      const added = await tx
        .insert(s.userSkills)
        .values(input.additions.map((a) => ({ userId, name: a.name, level: a.level })))
        .onConflictDoNothing()
        .returning({ id: s.userSkills.id });
      changed += added.length;
    }
    return { changed, capExceeded: false };
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
