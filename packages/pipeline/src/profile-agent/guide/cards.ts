/**
 * Tarjetas de la guía (ADR-034 §1 y §2, R10-4). Puro y sin modelo: salen de las respuestas de la persona,
 * de las palabras curadas a mano (`alerts/portal-guide.ts`) y de datos del pool de su carrera. «El modelo
 * evalúa, el código decide»: una guía sin modelo no puede prometer ni inventar una skill a reforzar. Cada
 * tarjeta se valida con el esquema estricto y pasa por `screenProfileCard`.
 */
import { alertKeywordsFor, type AlertLanguage } from "../../alerts/portal-guide";
import {
  ALERT_PORTAL_IDS,
  profileGuideCardSchema,
  type ProfileGuideAnswers,
  type ProfileGuideCard,
} from "../schemas";
import { screenProfileCard } from "../screen";
import { isGuideSeniority } from "./steps";

/** Mínimo de ofertas del pool de la carrera para hablar de demanda: con menos, no se propone nada. */
export const GUIDE_MIN_POOL = 10;
/** Una skill se propone si la piden al menos este porcentaje de las ofertas y un mínimo absoluto. */
export const GUIDE_MIN_SHARE = 0.2;
export const GUIDE_MIN_OFFERS = 3;
export const GUIDE_MAX_REINFORCE = 3;
/** Nivel a partir del cual la persona ya la maneja y no hace falta reforzarla (productivo). */
export const GUIDE_REINFORCE_BELOW_LEVEL = 2;
export const GUIDE_MAX_ALERT_KEYWORDS = 8;

export type GuideDemandSkill = { slug: string; name: string; jobs: number; must: number };
/** Lo que piden las ofertas públicas del pool de la carrera. Solo datos, sin usuarios. */
export type GuideDemand = { poolSize: number; skills: readonly GuideDemandSkill[] };

/** Del mercado por carrera (`CareerMarket`) a lo que necesita la guía. */
export function guideDemandFromMarket(market: {
  total: number;
  skills: readonly { slug: string; name: string; jobs: number; must: number }[];
}): GuideDemand {
  return {
    poolSize: market.total,
    skills: market.skills.map(({ slug, name, jobs, must }) => ({ slug, name, jobs, must })),
  };
}

/**
 * Skills a reforzar: las más pedidas del pool de la carrera que la persona no maneja todavía. `levels` =
 * nivel declarado por slug (0 a 3); sin dato cuenta como 0. Orden: más ofertas, después las que más piden
 * como excluyentes, después el slug. Pool chico (menos de `GUIDE_MIN_POOL`): vacío, falla cerrado.
 */
export function selectReinforceSkills(
  demand: GuideDemand,
  levels: Readonly<Record<string, number>>,
): { slug: string; name: string; offersAsking: number; poolSize: number }[] {
  if (!(demand.poolSize >= GUIDE_MIN_POOL)) return [];
  return demand.skills
    .filter(
      (k) =>
        k.jobs >= GUIDE_MIN_OFFERS &&
        k.jobs <= demand.poolSize &&
        k.jobs / demand.poolSize >= GUIDE_MIN_SHARE &&
        (levels[k.slug] ?? 0) < GUIDE_REINFORCE_BELOW_LEVEL,
    )
    .sort((a, b) => b.jobs - a.jobs || b.must - a.must || a.slug.localeCompare(b.slug))
    .slice(0, GUIDE_MAX_REINFORCE)
    .map((k) => ({
      slug: k.slug,
      name: k.name,
      offersAsking: k.jobs,
      poolSize: demand.poolSize,
    }));
}

/**
 * La tarjeta de skill a reforzar que vuelve del navegador no se cree: la evidencia y el nombre salen del pool
 * de la carrera que calcula el servidor. Devuelve la tarjeta con los datos del servidor, o `null` si la skill
 * no está entre las que hoy propondría la guía.
 */
export function verifyReinforceCard(
  card: Extract<ProfileGuideCard, { kind: "reinforce" }>,
  demand: GuideDemand | null,
  levels: Readonly<Record<string, number>>,
): Extract<ProfileGuideCard, { kind: "reinforce" }> | null {
  if (!demand) return null;
  const pick = selectReinforceSkills(demand, levels).find((k) => k.slug === card.slug);
  if (!pick) return null;
  const trusted = {
    kind: "reinforce" as const,
    slug: pick.slug,
    name: pick.name,
    evidence: { offersAsking: pick.offersAsking, poolSize: pick.poolSize },
  };
  const parsed = profileGuideCardSchema.safeParse(trusted);
  return parsed.success && parsed.data.kind === "reinforce" ? parsed.data : null;
}

/** Reglas que el esquema compartido no expresa: los años de una tarjeta de criterios son los de las opciones. */
export function guideCardAllowed(card: ProfileGuideCard): boolean {
  return (
    card.kind !== "criteria" || card.maxYearsHard === null || isGuideSeniority(card.maxYearsHard)
  );
}

export type GuideCardsInput = {
  answers: ProfileGuideAnswers;
  /** Idioma de las ofertas que busca (del perfil); por defecto los dos. */
  language: AlertLanguage;
  demand: GuideDemand | null;
  /** Nivel declarado por slug. */
  levels: Readonly<Record<string, number>>;
};

/**
 * Las tarjetas que propone la guía, en orden: puestos, criterios, palabras de alerta (una por portal) y
 * skills a reforzar. Solo con lo que la persona eligió; una tarjeta que no valida o no pasa el filtro se
 * descarta entera.
 */
export function buildGuideCards(input: GuideCardsInput): ProfileGuideCard[] {
  const { answers } = input;
  const raw: unknown[] = [];
  const roles = answers.roles ?? [];
  if (roles.length > 0) raw.push({ kind: "roles", roles });

  const modalities =
    answers.modalities && answers.modalities.length > 0 ? answers.modalities : null;
  const criteria = {
    kind: "criteria",
    modalities,
    country: answers.country ?? null,
    maxYearsHard: answers.maxYearsHard ?? null,
    salaryFloorUsdMonthly: answers.salaryFloorUsdMonthly ?? null,
    titleBlocklistAdd: answers.avoid ?? [],
  };
  const hasCriteria =
    criteria.modalities !== null ||
    criteria.country !== null ||
    criteria.maxYearsHard !== null ||
    criteria.salaryFloorUsdMonthly !== null ||
    criteria.titleBlocklistAdd.length > 0;
  if (hasCriteria) raw.push(criteria);

  // Sin puestos no hay palabras (R6-4): no se le ofrece algo que no eligió
  const keywords = alertKeywordsFor(roles, input.language).slice(0, GUIDE_MAX_ALERT_KEYWORDS);
  if (keywords.length > 0) {
    for (const portal of ALERT_PORTAL_IDS) {
      raw.push({ kind: "alert_keywords", portal, language: input.language, keywords });
    }
  }

  if (input.demand) {
    for (const k of selectReinforceSkills(input.demand, input.levels)) {
      raw.push({
        kind: "reinforce",
        slug: k.slug,
        name: k.name,
        evidence: { offersAsking: k.offersAsking, poolSize: k.poolSize },
      });
    }
  }

  const out: ProfileGuideCard[] = [];
  for (const r of raw) {
    const parsed = profileGuideCardSchema.safeParse(r);
    if (parsed.success && screenProfileCard(parsed.data).ok) out.push(parsed.data);
  }
  return out;
}
