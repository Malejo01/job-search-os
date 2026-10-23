import type { Checklist, ChecklistStatus } from "../evaluator/checklist";

/**
 * «Tu encaje» (C-6, ticket E1). Puro y determinista: agrega los checklists ya guardados y las skills
 * de las ofertas de la persona, y responde en llano qué la frena, qué no sabemos, qué ya tiene, qué
 * le falta y qué tiene de más. No usa LLM: los textos salen de plantillas cerradas.
 */

/**
 * Grupos de requisitos estructurados del checklist, en el orden en que mira un reclutador. Es el
 * mismo orden que `DESCARTE_ORDER` de `evaluator/checklist.ts` (no exportado): si cambia uno,
 * cambia el otro. Residencia y país se agrupan: los dos responden «desde dónde se puede trabajar».
 */
export const FIT_GROUPS = [
  { key: "donde", ids: ["residencia", "pais"], label: "Desde dónde se puede trabajar" },
  { key: "autorizacion", ids: ["autorizacion"], label: "Permiso de trabajo" },
  { key: "modalidad", ids: ["modalidad"], label: "Remoto, híbrido o presencial" },
  { key: "disciplina", ids: ["disciplina"], label: "Que sea tu mismo oficio" },
  { key: "anos", ids: ["anos"], label: "Años de experiencia" },
  { key: "ingles", ids: ["ingles"], label: "Inglés" },
  { key: "salario", ids: ["salario"], label: "Sueldo" },
  { key: "jornada", ids: ["jornada"], label: "Horas por semana" },
] as const;

export type FitGroupKey = (typeof FIT_GROUPS)[number]["key"];

export const FIT_THRESHOLDS = {
  /** Con menos ofertas con checklist no hay rankings: solo conteos. */
  minBase: 5,
  /** Un freno o un dato faltante entra con al menos esta cantidad de ofertas... */
  groupMinCount: 2,
  /** ...y llegando a esta proporción de la base. */
  groupMinShare: 0.2,
  /** Una skill entra en «ya tenés», «te falta» o «sin nivel» si la piden al menos tantas ofertas. */
  skillMinOffers: 2,
  /** «Te sobra» solo con al menos tantas ofertas. */
  surplusMinOffers: 10,
  /** Y solo para skills que el mercado de la carrera casi no pide. */
  surplusMaxMarketShare: 0.05,
  maxGroups: 3,
  maxSkills: 5,
} as const;

export type FitOffer = {
  /** El checklist guardado; null en evaluaciones viejas, que no cuentan para los requisitos. */
  checklist: Checklist | null;
  /** Skills que pide la oferta (job_skills), con `isMust` si es excluyente. */
  skills: readonly { slug: string; isMust: boolean }[];
};

export type FitInput = {
  offers: readonly FitOffer[];
  /** skill_levels de la persona por slug (0–3). Sin fila = no lo cargó (no es 0). */
  levels: ReadonlyMap<string, number>;
  /** Nombre legible por slug; sin él se usa el slug. */
  skillNames?: ReadonlyMap<string, string>;
  /** `share` de cada skill en el mercado público de la carrera (0–1); null si no hay datos. */
  marketShare: ReadonlyMap<string, number> | null;
};

export type FitGroup = { key: FitGroupKey; label: string; count: number };
export type FitSkill = { slug: string; name: string; count: number; mustCount: number };
export type FitSkillLevel = FitSkill & { level: number };

export type FitSummary = {
  basis: { offers: number; withChecklist: number; smallSample: boolean };
  blockers: FitGroup[];
  unknowns: FitGroup[];
  strengths: FitSkillLevel[];
  gaps: FitSkillLevel[];
  unrated: FitSkill[];
  surplus: { slug: string; name: string; level: number }[];
  headline: string;
};

type Group = (typeof FIT_GROUPS)[number];

function hasStatus(checklist: Checklist, group: Group, status: ChecklistStatus): boolean {
  const ids: readonly string[] = group.ids;
  for (const item of checklist.items) {
    if (item.kind !== "estructurado") continue;
    if (ids.includes(item.id) && item.status === status) return true;
  }
  return false;
}

/** Cuántas ofertas tienen el grupo en ese estado; una oferta cuenta una sola vez por grupo. */
function groupCounts(offers: readonly FitOffer[], status: ChecklistStatus) {
  const counts = new Map<FitGroupKey, number>();
  for (const { checklist } of offers) {
    if (!checklist) continue;
    for (const group of FIT_GROUPS) {
      if (!hasStatus(checklist, group, status)) continue;
      counts.set(group.key, (counts.get(group.key) ?? 0) + 1);
    }
  }
  return counts;
}

function rankGroups(counts: Map<FitGroupKey, number>, base: number): FitGroup[] {
  const t = FIT_THRESHOLDS;
  const rows: (FitGroup & { order: number })[] = [];
  FIT_GROUPS.forEach((g, order) => {
    const count = counts.get(g.key) ?? 0;
    if (count < t.groupMinCount || count < base * t.groupMinShare) return;
    rows.push({ key: g.key, label: g.label, count, order });
  });
  rows.sort((a, b) => b.count - a.count || a.order - b.order);
  return rows.slice(0, t.maxGroups).map(({ key, label, count }) => ({ key, label, count }));
}

function bySkill(a: FitSkill, b: FitSkill): number {
  return b.count - a.count || b.mustCount - a.mustCount || a.slug.localeCompare(b.slug);
}

/** Skills pedidas: en cuántas ofertas y en cuántas como excluyente (una vez por oferta). */
function askedSkills(offers: readonly FitOffer[], name: (slug: string) => string) {
  const asked = new Map<string, FitSkill>();
  for (const offer of offers) {
    const seen = new Map<string, boolean>();
    for (const s of offer.skills) seen.set(s.slug, (seen.get(s.slug) ?? false) || s.isMust);
    for (const [slug, isMust] of seen) {
      const row = asked.get(slug) ?? { slug, name: name(slug), count: 0, mustCount: 0 };
      row.count += 1;
      if (isMust) row.mustCount += 1;
      asked.set(slug, row);
    }
  }
  return asked;
}

/** «Te sobra»: lo que sabés bien, que tus ofertas casi no piden y el mercado tampoco. */
function surplusSkills(
  input: FitInput,
  asked: Map<string, FitSkill>,
  name: (slug: string) => string,
) {
  const t = FIT_THRESHOLDS;
  const market = input.marketShare;
  if (!market || input.offers.length < t.surplusMinOffers) return [];
  const out: { slug: string; name: string; level: number }[] = [];
  for (const [slug, level] of input.levels) {
    if (level < 2 || (asked.get(slug)?.count ?? 0) > 1) continue;
    if ((market.get(slug) ?? 0) >= t.surplusMaxMarketShare) continue;
    out.push({ slug, name: name(slug), level });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out.slice(0, t.maxSkills);
}

export function buildFitSummary(input: FitInput): FitSummary {
  const t = FIT_THRESHOLDS;
  const name = (slug: string) => input.skillNames?.get(slug) ?? slug;
  const withChecklist = input.offers.filter((o) => o.checklist !== null).length;
  const smallSample = withChecklist < t.minBase;
  const failCounts = groupCounts(input.offers, "no_cumple");
  const unknownCounts = groupCounts(input.offers, "no_se_sabe");
  const blockers = smallSample ? [] : rankGroups(failCounts, withChecklist);
  const unknowns = smallSample ? [] : rankGroups(unknownCounts, withChecklist);

  const asked = askedSkills(input.offers, name);
  const frequent = [...asked.values()].filter((s) => s.count >= t.skillMinOffers);
  frequent.sort(bySkill);
  const leveled: FitSkillLevel[] = [];
  const unrated: FitSkill[] = [];
  for (const s of frequent) {
    const level = input.levels.get(s.slug);
    if (level === undefined) unrated.push(s);
    else leveled.push({ ...s, level });
  }
  const strengths = leveled.filter((s) => s.level >= 2).slice(0, t.maxSkills);
  const gaps = leveled.filter((s) => s.level <= 1).slice(0, t.maxSkills);

  return {
    basis: { offers: input.offers.length, withChecklist, smallSample },
    blockers,
    unknowns,
    strengths,
    gaps,
    unrated: unrated.slice(0, t.maxSkills),
    surplus: surplusSkills(input, asked, name),
    headline: fitHeadline({ smallSample, withChecklist, blockers, unknowns, gaps }),
  };
}

const SMALL_SAMPLE_HEADLINE =
  "Todavía tenés pocas ofertas evaluadas para decir cómo encajás. Mirá el mercado de tu carrera.";

/** Titular de «Tu encaje»: una de cinco plantillas cerradas. */
export function fitHeadline(s: {
  smallSample: boolean;
  withChecklist: number;
  blockers: FitGroup[];
  unknowns: FitGroup[];
  gaps: FitSkillLevel[];
}): string {
  if (s.smallSample) return SMALL_SAMPLE_HEADLINE;
  const blocker = s.blockers[0];
  const unknown = s.unknowns[0];
  if (unknown && unknown.count > (blocker?.count ?? 0)) {
    return `Nos faltan datos tuyos para decirlo: completá «${unknown.label}».`;
  }
  if (blocker) {
    const where = `${blocker.count} de ${s.withChecklist} ofertas`;
    return `Lo que más te frena es «${blocker.label}»: aparece en ${where}.`;
  }
  const gap = s.gaps[0];
  if (gap) return `Los requisitos básicos los cumplís. Lo que más piden y te falta es ${gap.name}.`;
  return "Cumplís lo que piden la mayoría de tus ofertas.";
}
