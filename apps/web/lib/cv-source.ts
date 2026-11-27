import { schema as s } from "@job-search-os/db";
import {
  buildCvDocument,
  type CvDocument,
  type CvHistoryInput,
  type CvLang,
  type CvSourceData,
} from "@job-search-os/pipeline";
import { and, asc, eq, gte } from "drizzle-orm";
import { CV_LINK_KEYS, type CvLinkKey } from "./cv-options-query";
import { withUser } from "./db";

/**
 * Datos del CV (C-25, CVC-2), solo servidor. Solo lo que la persona confirmó; nada pasa por un modelo.
 * Todo corre en `withUser`. El teléfono es opcional: vive en `application_settings.links` y solo sale si
 * se pide (`includePhone`); foto, nacimiento, documento y dirección ni existen en las tablas.
 */
export type CvOptions = {
  lang: CvLang;
  includeEmail: boolean;
  /** Incluye las skills de nivel 1 (por defecto solo nivel 2 o más). */
  includeBasics: boolean;
  /** R33-07: ciudad y país en el encabezado (no es la dirección). Por defecto sí, si hay. */
  includePlace?: boolean;
  /** R33-07: cada link cargado, incluido por defecto; sin un link cargado la opción no hace nada. */
  includeLinks?: { linkedin: boolean; github: boolean; portfolio: boolean; otro?: boolean };
  /** R33-07: teléfono en el encabezado. **Sin marcar por defecto**; solo la marca viaja en la URL. */
  includePhone?: boolean;
};

export { CV_LINK_KEYS, cvOptionsQuery, type CvLinkKey } from "./cv-options-query";

export function parseCvOptions(params: {
  lang?: string;
  email?: string;
  basicas?: string;
  lugar?: string;
  tel?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  otro?: string;
}): CvOptions {
  return {
    lang: params.lang === "en" ? "en" : "es",
    includeEmail: params.email !== "0",
    includeBasics: params.basicas === "1",
    includePlace: params.lugar !== "0",
    includePhone: params.tel === "1",
    includeLinks: {
      linkedin: params.linkedin !== "0",
      github: params.github !== "0",
      portfolio: params.portfolio !== "0",
      otro: params.otro !== "0",
    },
  };
}

/** Las opciones desde la consulta de una URL (la vista previa y las dos descargas leen lo mismo). */
export function cvOptionsFromSearchParams(sp: URLSearchParams): CvOptions {
  const get = (k: string) => sp.get(k) ?? undefined;
  return parseCvOptions({
    lang: get("lang"),
    email: get("email"),
    basicas: get("basicas"),
    lugar: get("lugar"),
    tel: get("tel"),
    linkedin: get("linkedin"),
    github: get("github"),
    portfolio: get("portfolio"),
    otro: get("otro"),
  });
}

/**
 * Lo que la persona cargó para el encabezado, tal como está guardado (sin filtrar por las opciones del CV):
 * los cuatro links, la etiqueta del «otro» y el teléfono. Todo vive en `application_settings.links` (jsonb,
 * claves `otro_etiqueta` y `telefono`). Solo servidor.
 */
export type CvStoredContact = Partial<Record<CvLinkKey | "otroEtiqueta" | "telefono", string>>;

export async function loadCvLinks(userId: string): Promise<CvStoredContact> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ links: s.applicationSettings.links })
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, userId))
      .limit(1);
    const stored = (row?.links ?? {}) as Record<string, unknown>;
    const out: CvStoredContact = {};
    const text = (k: string) =>
      typeof stored[k] === "string" && stored[k] !== "" ? (stored[k] as string) : null;
    for (const k of CV_LINK_KEYS) {
      const v = text(k);
      if (v) out[k] = v;
    }
    const label = text("otro_etiqueta");
    if (label) out.otroEtiqueta = label;
    const phone = text("telefono");
    if (phone) out.telefono = phone;
    return out;
  });
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
    // R33-07: los links desmarcados no llegan al CV (la URL guardada no se toca)
    const stored = (settings?.links ?? {}) as Record<string, string | undefined>;
    const links = {
      ...Object.fromEntries(
        (["linkedin", "github", "portfolio"] as const)
          .filter((k) => opts.includeLinks?.[k] !== false && stored[k])
          .map((k) => [k, stored[k]]),
      ),
      other:
        opts.includeLinks?.otro !== false && stored.otro
          ? { label: stored.otro_etiqueta ?? null, url: stored.otro }
          : null,
    };
    return {
      displayName: profile.displayName,
      email: user?.email ?? null,
      // El teléfono solo se lee si se pide incluirlo (R33-07); por defecto no sale
      phone: opts.includePhone === true ? (stored.telefono ?? null) : null,
      city: profile.city,
      country: profile.country,
      links,
      headline: profile.headline,
      // R11-12: `profile_summary` está escrito para la IA y dice lo que la persona no sabe: no es
      // el resumen del CV. Sin campo propio (no hay migración), queda vacío y el CV invita a
      // escribirlo o a armarlo con el chat.
      summary: null,
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
        link: h.link,
      })),
    };
  });
}

/** El CV armado desde los datos de la persona, o `null` si no tiene perfil. */
export async function buildUserCv(userId: string, opts: CvOptions): Promise<CvDocument | null> {
  const data = await loadCvSource(userId, opts);
  if (!data) return null;
  return buildCvDocument(data, {
    lang: opts.lang,
    includeEmail: opts.includeEmail,
    includePlace: opts.includePlace,
    includePhone: opts.includePhone,
    // El paquete no mira el reloj (ADR-001): el mes actual lo pone la app (C-62, «Actualidad»)
    today: new Date().toISOString().slice(0, 7),
  });
}

/**
 * Interruptor del chat «Armá tu CV con IA» (CVC-5): `CV_CHAT_ENABLED` = `admin` | `all`; apagado por
 * defecto. Acá solo decide si se muestra el link; la ruta del chat repite el chequeo.
 */
export { cvChatMode } from "@job-search-os/pipeline";
