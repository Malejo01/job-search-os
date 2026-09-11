/**
 * Pre-score determinista (modo offline del evaluador): lo que se sabe de una oferta SIN LLM.
 * Sirve para decidir si vale la pena abrirla cuando el modelo todavía no corrió (sin créditos,
 * cola atrasada). Se marca siempre como "pre-score": no es el score del modelo ni lo reemplaza.
 *
 * Insumos deterministas: flags del prefiltro (riesgos, cap de título), skills mencionadas en el
 * stack o la JD cruzadas con skill_levels, y el salario contra el piso del perfil.
 */
export type PreScoreInput = {
  /** jobs.flags: location_risk, many_candidates, domain_keyword:<kw>, title_cap:<n>, volume_recruiting */
  flags: readonly string[];
  /** Skills mencionadas (job_skills) y su nivel propio (skill_levels); null = sin nivel cargado. */
  skills: readonly { slug: string; name: string; isMust: boolean; level: number | null }[];
  salaryMaxUsd: number | null;
  /** Piso mensual en USD del perfil; null = no aplica. */
  salaryFloorUsd: number | null;
};

export type PreScoreAdjustment = { rule: string; delta: number; detail: string };

export type PreScore = {
  /** 0–10 en pasos de 0,5. */
  score: number;
  /** Skills con nivel ≥ 2 sobre las mencionadas; null si no hay skills mapeadas. */
  coverage: number | null;
  have: string[];
  missing: string[];
  /** Mencionadas sin nivel cargado: no cuentan ni a favor ni en contra. */
  unknown: string[];
  riesgos: string[];
  cap: number | null;
  adjustments: PreScoreAdjustment[];
};

const RISK_LABELS: Record<string, string> = {
  location_risk: "ubicación con riesgo (país no listado o LATAM sin países)",
  many_candidates: "muchos candidatos",
  volume_recruiting: "aviso repetido (volume recruiting)",
};

export const PRESCORE_BASE = 3;
export const PRESCORE_COVERAGE_WEIGHT = 6;

const half = (n: number) => Math.round(n * 2) / 2;

export function preScore(input: PreScoreInput): PreScore {
  const adjustments: PreScoreAdjustment[] = [];
  const known = input.skills.filter((s) => s.level !== null);
  const have = known.filter((s) => (s.level ?? 0) >= 2).map((s) => s.name);
  const missing = known.filter((s) => (s.level ?? 0) < 2).map((s) => s.name);
  const unknown = input.skills.filter((s) => s.level === null).map((s) => s.name);
  const coverage = known.length ? have.length / known.length : null;

  let score: number;
  if (coverage === null) {
    score = 5;
    adjustments.push({
      rule: "sin_skills",
      delta: 0,
      detail: "sin skills mapeadas contra tu nivel: se asume 5",
    });
  } else {
    score = PRESCORE_BASE + PRESCORE_COVERAGE_WEIGHT * coverage;
    adjustments.push({
      rule: "cobertura",
      delta: Math.round(PRESCORE_COVERAGE_WEIGHT * coverage * 10) / 10,
      detail: `${have.length} de ${known.length} skills con nivel productivo o fuerte`,
    });
  }

  const riesgos: string[] = [];
  let cap: number | null = null;
  for (const f of input.flags) {
    if (f.startsWith("title_cap:")) {
      cap = Number(f.slice("title_cap:".length));
      continue;
    }
    if (f.startsWith("domain_keyword:")) {
      riesgos.push(`dominio ajeno: ${f.slice("domain_keyword:".length)}`);
      score -= 0.5;
      adjustments.push({ rule: "riesgo_dominio", delta: -0.5, detail: f });
      continue;
    }
    if (f in RISK_LABELS) {
      riesgos.push(RISK_LABELS[f]!);
      const delta = f === "location_risk" ? -1 : -0.5;
      score += delta;
      adjustments.push({ rule: `riesgo_${f}`, delta, detail: RISK_LABELS[f]! });
    }
  }
  if (
    input.salaryFloorUsd !== null &&
    input.salaryMaxUsd !== null &&
    input.salaryMaxUsd < input.salaryFloorUsd
  ) {
    score -= 1;
    riesgos.push(
      `salario máximo ${input.salaryMaxUsd} por debajo del piso ${input.salaryFloorUsd}`,
    );
    adjustments.push({ rule: "salario_bajo_piso", delta: -1, detail: "salario máximo < piso" });
  }
  if (cap !== null && score > cap) {
    adjustments.push({ rule: "title_cap", delta: cap - score, detail: `cap por título: ${cap}` });
    score = cap;
  }
  score = half(Math.max(0, Math.min(10, score)));
  return { score, coverage, have, missing, unknown, riesgos, cap, adjustments };
}
