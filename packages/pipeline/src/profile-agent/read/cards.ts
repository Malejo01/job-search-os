/**
 * Tarjetas de la lectura (ADR-034 §2 y §3, R10-2). Puro. Dos mitades:
 *
 * 1. `buildReadCards`: la propuesta ya normalizada (`CvProposal`) → tarjetas editables para el navegador.
 *    Cada tarjeta pasa el esquema estricto y `screenProfileCards`; la que trae un dato sensible o una
 *    instrucción escondida se DESCARTA entera, no se «limpia». Lo que el CV no dice queda vacío.
 * 2. `reviewCardDecisions`: lo que vuelve del navegador es entrada no confiable. Se vuelve a validar y a
 *    filtrar, y los `slug` se comparan con la taxonomía (O6): el que no está se descarta, nunca se guarda
 *    como skill propia. Devuelve lo que se puede guardar; el guardado lo hace el adaptador, con RLS.
 */
import { CEFR_LEVELS } from "../../onboarding";
import { validateHistory, type HistoryInput } from "../../cv-out/history";
import type { CvProposal } from "../../cv/extraction";
import { validateCustomSkillName } from "../../skills/custom-skills";
import type { CefrLevel } from "../../skills/english";
import type { SkillTaxonomyEntry } from "../../skills/match";
import {
  PROFILE_AGENT_MAX_CARDS,
  profileReadCardSchema,
  type ExperienceCard,
  type EducationCard,
  type ProfileCardDecision,
  type ProfileReadCard,
  type ProfileReadProposal,
} from "../schemas";
import { cardToHistoryInput, screenProfileCard, screenProfileCards } from "../screen";

type Taxonomy = readonly SkillTaxonomyEntry[];

// ---------------------------------------------------------------------------
// Propuesta → tarjetas
// ---------------------------------------------------------------------------

/** Una fecha de fin sin inicio no se propone: se dejan las dos en `null` y la persona completa el inicio. */
function dates(
  start: string | null,
  end: string | null,
): { startMonth: string | null; endMonth: string | null } {
  return start === null
    ? { startMonth: null, endMonth: null }
    : { startMonth: start, endMonth: end };
}

export function buildReadCards(proposal: CvProposal, taxonomy: Taxonomy): ProfileReadProposal {
  const names = new Map(taxonomy.map((t) => [t.slug, t.name]));
  const candidates: unknown[] = [];

  proposal.workHistory.forEach((w, i) => {
    candidates.push({
      kind: "experience",
      id: `exp:${i}`,
      organization: w.company,
      title: w.title,
      ...dates(w.start, w.end),
      // El CV no dice si el trabajo sigue vigente con certeza: lo marca la persona en la tarjeta
      isCurrent: false,
      bullets: [],
    } satisfies ExperienceCard);
  });
  proposal.education.forEach((e, i) => {
    candidates.push({
      kind: "education",
      id: `edu:${i}`,
      institution: e.institution,
      title: e.title,
      ...dates(e.start, e.end),
    } satisfies EducationCard);
  });
  let skillIndex = 0;
  for (const k of proposal.skills) {
    const name = names.get(k.slug);
    if (name === undefined) continue; // no está en la taxonomía: no se propone
    candidates.push({
      kind: "skill",
      id: `skill:${skillIndex++}`,
      name,
      slug: k.slug,
      level: k.level,
      verified: k.verified,
    });
  }
  for (const term of proposal.otherTerms) {
    const check = validateCustomSkillName(term, taxonomy);
    if (!check.ok) continue;
    candidates.push({
      kind: "skill",
      id: `skill:${skillIndex++}`,
      name: check.name,
      slug: null,
      level: null,
      verified: false,
    });
  }
  proposal.languages.forEach((l, i) => {
    candidates.push({ kind: "language", id: `lang:${i}`, name: l.name, level: l.level });
  });

  let dropped = Object.values(proposal.flags.dropped).reduce((t, n) => t + (n ?? 0), 0);
  const valid: ProfileReadCard[] = [];
  for (const c of candidates) {
    const parsed = profileReadCardSchema.safeParse(c);
    if (parsed.success) valid.push(parsed.data);
    else dropped += 1;
  }
  const screened = screenProfileCards(valid);
  dropped += screened.dropped.length;
  const cards = screened.kept.slice(0, PROFILE_AGENT_MAX_CARDS);
  dropped += screened.kept.length - cards.length;

  return {
    cards,
    suggestedRoles: [...proposal.suggestedRoles],
    dropped: Math.min(dropped, 999),
  };
}

// ---------------------------------------------------------------------------
// Decisiones del navegador → lo que se puede guardar
// ---------------------------------------------------------------------------

export type CardRejection =
  | "missing_card"
  | "id_mismatch"
  | "duplicate_id"
  | "bad_card"
  | "sensitive"
  | "injection"
  | "level_missing"
  | "slug_unknown"
  | "skill_name";

export type AcceptedCard =
  | { id: string; kind: "history"; input: HistoryInput }
  /** Skill de la taxonomía → `skill_levels`. */
  | { id: string; kind: "skill"; slug: string; level: 1 | 2 | 3 }
  /** Skill propia → `user_skills`. */
  | { id: string; kind: "custom_skill"; name: string; level: 1 | 2 | 3 }
  /** Inglés con nivel CEFR → `profiles.english_cefr`. */
  | { id: string; kind: "english"; cefr: CefrLevel }
  /** Otro idioma (o inglés sin nivel): no hay dónde guardarlo (ADR-026 §4); solo viaja en la vista previa. */
  | { id: string; kind: "language_preview"; name: string; level: string | null };

export type CardReview = {
  accepted: AcceptedCard[];
  rejected: { id: string; reason: CardRejection }[];
  discarded: string[];
};

const PREFIX_KIND: Record<string, ProfileReadCard["kind"]> = {
  exp: "experience",
  edu: "education",
  skill: "skill",
  lang: "language",
};

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Nivel CEFR (`C1`) dentro del texto de un idioma («C1», «C1 avanzado», «b2»), o `null`. */
export function cefrFromLevel(level: string | null): CefrLevel | null {
  if (level === null) return null;
  const m = /(?<![A-Za-z0-9])([ABC][12])(?![A-Za-z0-9])/i.exec(level);
  const code = m?.[1]?.toUpperCase();
  return CEFR_LEVELS.find((l) => l === code) ?? null;
}

const isEnglish = (name: string): boolean => /^(ingles|english)$/.test(fold(name));

function reviewOne(
  d: ProfileCardDecision,
  taxonomy: Taxonomy,
  slugs: ReadonlySet<string>,
): { ok: true; card: AcceptedCard } | { ok: false; reason: CardRejection } {
  if (d.card === undefined) return { ok: false, reason: "missing_card" };
  // La tarjeta se vuelve a validar con el esquema estricto: lo que vuelve del navegador no es de confianza
  const parsed = profileReadCardSchema.safeParse(d.card);
  if (!parsed.success) return { ok: false, reason: "bad_card" };
  const card = parsed.data;
  const prefix = card.id.split(":")[0] ?? "";
  if (card.id !== d.id || PREFIX_KIND[prefix] !== card.kind)
    return { ok: false, reason: "id_mismatch" };

  const screen = screenProfileCard(card);
  if (!screen.ok) return { ok: false, reason: screen.reason };

  switch (card.kind) {
    case "experience":
    case "education": {
      // Las tarjetas de lectura no llevan viñetas: las dice la persona en la etapa de huecos
      if (card.kind === "experience" && card.bullets.length > 0)
        return { ok: false, reason: "bad_card" };
      const input = cardToHistoryInput(card);
      const checked = validateHistory({
        get: (name) =>
          name === "bullets" ? input.bullets.join("\n") : (input as Record<string, unknown>)[name],
      });
      return checked.ok
        ? { ok: true, card: { id: d.id, kind: "history", input: checked.value } }
        : { ok: false, reason: "bad_card" };
    }
    case "skill": {
      if (card.level === null) return { ok: false, reason: "level_missing" };
      if (card.slug !== null) {
        // O6: un slug que no está en la taxonomía se descarta, no se guarda como skill propia
        return slugs.has(card.slug)
          ? { ok: true, card: { id: d.id, kind: "skill", slug: card.slug, level: card.level } }
          : { ok: false, reason: "slug_unknown" };
      }
      const name = validateCustomSkillName(card.name, taxonomy);
      if (name.ok) {
        return {
          ok: true,
          card: { id: d.id, kind: "custom_skill", name: name.name, level: card.level },
        };
      }
      // Escribió el nombre de una skill de la lista: se guarda como esa skill
      if (name.reason === "en_taxonomia" && name.existing && slugs.has(name.existing.slug)) {
        return {
          ok: true,
          card: { id: d.id, kind: "skill", slug: name.existing.slug, level: card.level },
        };
      }
      return { ok: false, reason: "skill_name" };
    }
    case "language": {
      const cefr = isEnglish(card.name) ? cefrFromLevel(card.level) : null;
      return cefr
        ? { ok: true, card: { id: d.id, kind: "english", cefr } }
        : {
            ok: true,
            card: { id: d.id, kind: "language_preview", name: card.name, level: card.level },
          };
    }
  }
}

export function reviewCardDecisions(
  decisions: readonly ProfileCardDecision[],
  taxonomy: Taxonomy,
): CardReview {
  const slugs = new Set(taxonomy.map((t) => t.slug));
  const seen = new Set<string>();
  const out: CardReview = { accepted: [], rejected: [], discarded: [] };
  for (const d of decisions) {
    if (seen.has(d.id)) {
      out.rejected.push({ id: d.id, reason: "duplicate_id" });
      continue;
    }
    seen.add(d.id);
    if (d.decision === "discard") {
      out.discarded.push(d.id);
      continue;
    }
    const r = reviewOne(d, taxonomy, slugs);
    if (r.ok) out.accepted.push(r.card);
    else out.rejected.push({ id: d.id, reason: r.reason });
  }
  return out;
}

/** Mensajes fijos por motivo de rechazo: nunca el texto de la tarjeta. */
export const CARD_REJECTION_MESSAGES: Record<CardRejection, string> = {
  missing_card: "Faltó el contenido de la tarjeta.",
  id_mismatch: "La tarjeta no coincide con lo que leímos.",
  duplicate_id: "La tarjeta venía repetida.",
  bad_card: "Revisá los campos de la tarjeta (fechas, largos, sin links ni emails).",
  sensitive: "La tarjeta tiene un dato personal que no se guarda en el perfil.",
  injection: "La tarjeta tiene un texto que no podemos usar.",
  level_missing: "Elegí un nivel para esta skill o descartala.",
  slug_unknown: "Esa skill no está en la lista.",
  skill_name: "El nombre de la skill no es válido (2 a 40 caracteres, sin links).",
};
