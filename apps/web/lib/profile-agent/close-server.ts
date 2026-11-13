import { schema as s, type Db } from "@job-search-os/db";
import {
  buildCvDocument,
  profileAgentAllowed,
  profileAgentMode,
  validateHistory,
  type CvDocument,
  type CvHistoryInput,
  type CvLang,
  type ProfileAgentOnboardingFacts,
  type ProfileCloseFacts,
  type ProfileWrittenEntry,
} from "@job-search-os/pipeline";
import { and, eq, gte, sql } from "drizzle-orm";
import { catalogLabel } from "@/lib/career-names";
import { listCareerHistory, updateCareerHistory } from "@/lib/career-history";
import { loadCvSource } from "@/lib/cv-source";
import { withUser } from "@/lib/db";
import { getTargetRoles } from "@/lib/onboarding";

/**
 * Parte de servidor del cierre del agente de perfil (ADR-034, R10-5). Todo con `withUser` (RLS) y además
 * filtrando por `user_id`. No se guarda ni el CV ni la charla: acá solo se lee lo que la persona ya
 * confirmó y, con su clic, se actualizan las viñetas de sus trabajos.
 */

/**
 * ¿Esta persona ve el agente (`CV_PROFILE_AGENT`, ADR-034 §7)? Sin flag o sin `CV_IMPORT_ENABLED=1` no hay
 * consulta; si la consulta falla, falla cerrado (no lo ve). Es la única puerta de esta etapa.
 */
export async function profileAgentEnabledFor(userId: string): Promise<boolean> {
  if (process.env.CV_IMPORT_ENABLED !== "1" || profileAgentMode(process.env) === "off")
    return false;
  try {
    const [me] = await withUser(userId, (tx) =>
      tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, userId)).limit(1),
    );
    return profileAgentAllowed(process.env, me?.email);
  } catch {
    return false;
  }
}

/** Nombres del catálogo de skills: una tecnología que el modelo nombra y la persona no dijo se descarta. */
export async function skillCatalogNames(db: Db): Promise<string[]> {
  const rows = await db.select({ name: s.skills.name }).from(s.skills).limit(3000);
  return rows.map((r) => r.name);
}

type CloseFactsWithIds = ProfileCloseFacts;

/** Lo confirmado hasta ahora, para armar la entrada de `cv_write`: historial, skills con nivel 2 o más e inglés. */
export async function loadProfileCloseFacts(
  userId: string,
  lang: CvLang,
): Promise<CloseFactsWithIds> {
  const [history, roles, skills, english] = await Promise.all([
    listCareerHistory(userId),
    getTargetRoles(userId),
    withUser(userId, async (tx) => {
      const levels = await tx
        .select({ name: s.skills.name })
        .from(s.skillLevels)
        .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
        .where(and(eq(s.skillLevels.userId, userId), gte(s.skillLevels.level, 2)));
      const own = await tx
        .select({ name: s.userSkills.name })
        .from(s.userSkills)
        .where(and(eq(s.userSkills.userId, userId), gte(s.userSkills.level, 2)));
      return [...levels, ...own].map((r) => r.name);
    }),
    withUser(userId, async (tx) => {
      const [p] = await tx
        .select({ english: s.profiles.englishCefr })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1);
      return p?.english ?? null;
    }),
  ]);
  const first = roles[0];
  return {
    lang,
    target: first ? catalogLabel(first) : null,
    history: history.map((h) => ({
      id: h.id,
      kind: h.kind,
      organization: h.organization,
      title: h.title,
      startMonth: h.startMonth,
      endMonth: h.endMonth,
      bullets: h.bullets,
    })),
    skills,
    languages: english ? [{ name: lang === "en" ? "English" : "Inglés", level: english }] : [],
  };
}

/**
 * La vista previa del CV: lo que hay en la base más las viñetas redactadas (en memoria, sin guardar) y el
 * resumen verificado. Sin fila de perfil devuelve `null`. Durante el onboarding el perfil todavía puede no
 * tener país ni resumen: `buildCvDocument` los deja afuera y el CV sale con historial y skills.
 */
export async function buildCloseDocument(
  userId: string,
  input: {
    lang: CvLang;
    written: readonly ProfileWrittenEntry[];
    summary: string | null;
  },
): Promise<CvDocument | null> {
  const base = await loadCvSource(userId, {
    lang: input.lang,
    includeEmail: true,
    includeBasics: false,
  });
  if (!base) return null;
  const byId = new Map(input.written.map((e) => [e.id, e.bullets]));
  const rows = await listCareerHistory(userId);
  const history = rows.map((h): CvHistoryInput => ({
    kind: h.kind,
    organization: h.organization,
    title: h.title,
    startMonth: h.startMonth,
    endMonth: h.endMonth,
    bullets: byId.get(h.id) ?? h.bullets,
  }));
  return buildCvDocument(
    { ...base, history, summary: input.summary ?? base.summary },
    { lang: input.lang, includeEmail: true },
  );
}

/**
 * Guarda las viñetas que la persona confirmó. Solo filas de trabajo de la persona (la RLS y el filtro por
 * `user_id` dejan afuera las ajenas) y con la misma validación de la carga manual (`validateHistory`).
 * Devuelve cuántas filas se actualizaron; un id que no es de la persona se ignora.
 */
export async function saveWrittenBullets(
  userId: string,
  entries: readonly ProfileWrittenEntry[],
): Promise<{ updated: number }> {
  const rows = await listCareerHistory(userId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let updated = 0;
  for (const e of entries) {
    const row = byId.get(e.id);
    if (!row || row.kind !== "trabajo" || e.bullets.length === 0) continue;
    const fields: Record<string, unknown> = {
      kind: row.kind,
      organization: row.organization,
      title: row.title,
      startMonth: row.startMonth ?? "",
      endMonth: row.endMonth ?? "",
      bullets: e.bullets.join("\n"),
    };
    const checked = validateHistory({ get: (name: string) => fields[name] ?? "" });
    if (!checked.ok) continue;
    if (await updateCareerHistory(userId, e.id, checked.value)) updated++;
  }
  return { updated };
}

/** Lo que el agente ya completó, derivado de la base (sin banderas en la URL): para saltear el paso de skills. */
export async function loadAgentOnboardingFacts(
  userId: string,
): Promise<ProfileAgentOnboardingFacts> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({
        levels: sql<number>`(select count(*)::int from ${s.skillLevels} where ${s.skillLevels.userId} = ${userId} and ${s.skillLevels.level} > 0)`,
        own: sql<number>`(select count(*)::int from ${s.userSkills} where ${s.userSkills.userId} = ${userId})`,
        cv: sql<number>`(select count(*)::int from ${s.careerHistory} where ${s.careerHistory.userId} = ${userId} and ${s.careerHistory.source} = 'cv')`,
      })
      .from(sql`(select 1) as one`);
    return {
      skillLevelCount: row?.levels ?? 0,
      customSkillCount: row?.own ?? 0,
      cvHistoryCount: row?.cv ?? 0,
    };
  });
}
