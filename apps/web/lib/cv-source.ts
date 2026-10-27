import { schema as s } from "@job-search-os/db";
import {
  buildCvDocument,
  type CvDocument,
  type CvHistoryInput,
  type CvLang,
  type CvSourceData,
} from "@job-search-os/pipeline";
import { and, asc, eq, gte } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Datos del CV (C-25, CVC-2), solo servidor. Solo lo que la persona confirmó; nada pasa por un modelo.
 * Todo corre en `withUser`. El teléfono no se guarda en ningún lado, y foto, nacimiento, documento y
 * dirección ni existen en las tablas.
 */
export type CvOptions = {
  lang: CvLang;
  includeEmail: boolean;
  /** Incluye las skills de nivel 1 (por defecto solo nivel 2 o más). */
  includeBasics: boolean;
};

export function parseCvOptions(params: {
  lang?: string;
  email?: string;
  basicas?: string;
}): CvOptions {
  return {
    lang: params.lang === "en" ? "en" : "es",
    includeEmail: params.email !== "0",
    includeBasics: params.basicas === "1",
  };
}

export async function loadCvSource(userId: string, opts: CvOptions): Promise<CvSourceData | null> {
  const minLevel = opts.includeBasics ? 1 : 2;
  return withUser(userId, async (tx) => {
    const [profile] = await tx
      .select({
        displayName: s.profiles.displayName,
        headline: s.profiles.headline,
        city: s.profiles.locationCity,
        country: s.profiles.locationCountry,
        summary: s.profiles.profileSummary,
        english: s.profiles.englishCefr,
      })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1);
    if (!profile) return null;
    const [user] = await tx
      .select({ email: s.users.email })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1);
    const [settings] = await tx
      .select({ links: s.applicationSettings.links })
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, userId))
      .limit(1);
    const levels = await tx
      .select({ name: s.skills.name, category: s.skills.category })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(and(eq(s.skillLevels.userId, userId), gte(s.skillLevels.level, minLevel)))
      .orderBy(asc(s.skills.category), asc(s.skills.name));
    const own = await tx
      .select({ name: s.userSkills.name })
      .from(s.userSkills)
      .where(and(eq(s.userSkills.userId, userId), gte(s.userSkills.level, minLevel)))
      .orderBy(asc(s.userSkills.name));
    const facts = await tx
      .select({ claim: s.candidateFacts.claim, metric: s.candidateFacts.metric })
      .from(s.candidateFacts)
      .where(and(eq(s.candidateFacts.userId, userId), eq(s.candidateFacts.active, true)))
      .orderBy(asc(s.candidateFacts.sort));
    const history = await tx
      .select()
      .from(s.careerHistory)
      .where(eq(s.careerHistory.userId, userId))
      .orderBy(asc(s.careerHistory.sort), asc(s.careerHistory.createdAt));

    const english = opts.lang === "en" ? "English" : "Inglés";
    return {
      displayName: profile.displayName,
      email: user?.email ?? null,
      city: profile.city,
      country: profile.country,
      links: settings?.links ?? {},
      headline: profile.headline,
      summary: profile.summary,
      skills: [...levels.map((r) => ({ name: r.name, category: r.category })), ...own],
      languages: profile.english ? [{ name: english, level: profile.english }] : [],
      achievements: facts.map((f) => (f.metric ? `${f.claim} (${f.metric})` : f.claim)),
      history: history.map((h): CvHistoryInput => ({
        kind: h.kind as CvHistoryInput["kind"],
        organization: h.organization,
        title: h.title,
        startMonth: h.startMonth,
        endMonth: h.endMonth,
        bullets: h.bullets,
      })),
    };
  });
}

/** El CV armado desde los datos de la persona, o `null` si no tiene perfil. */
export async function buildUserCv(userId: string, opts: CvOptions): Promise<CvDocument | null> {
  const data = await loadCvSource(userId, opts);
  if (!data) return null;
  return buildCvDocument(data, { lang: opts.lang, includeEmail: opts.includeEmail });
}

/**
 * Interruptor del chat «Armá tu CV con IA» (CVC-5): `CV_CHAT_ENABLED` = `admin` | `all`; apagado por
 * defecto. Acá solo decide si se muestra el link; la ruta del chat repite el chequeo.
 */
export { cvChatMode } from "@job-search-os/pipeline";
