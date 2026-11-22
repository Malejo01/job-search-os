/**
 * Detalle de la afinidad por criterio (sello de la oferta). Función pura: arma una barra de 0 a 10
 * por criterio SOLO con datos que la evaluación ya guardó (ajustes deterministas, calces, faltas y
 * campos extraídos). No lee el modelo ni cambia el puntaje final: es una explicación, no una
 * decisión. Sin datos para un criterio, devuelve `score: null` (nunca se inventa un número).
 * La palabra de cada nivel la pone la web (`AFFINITY_WORDS`).
 */

export type AffinityLevel = "high" | "mid" | "low" | "far";

export type AffinityKey = "role_skills" | "seniority" | "location" | "language" | "salary";

export type AffinityItem = {
  key: AffinityKey;
  /** 0 a 10 en pasos de 0,5; null si no hay datos para este criterio. */
  score: number | null;
  level: AffinityLevel | null;
};

export type AffinityAdjustment = { rule: string; delta: number; detail?: string | null };

export type AffinityInput = {
  matchFuerte: readonly string[];
  /** Faltas ya filtradas por quien llama (por ejemplo, sin el inglés si no es una falta). */
  gaps: readonly string[];
  riesgos: readonly string[];
  bloqueadores: readonly string[];
  adjustments: readonly AffinityAdjustment[];
  yearsRequired: number | null;
  /** "ok" | "riesgo" | "no"; null si no se conoce. */
  locationOk: string | null;
  modality: string | null;
  englishRequired: string | null;
  /** El inglés de la persona no alcanza para lo que pide el aviso. */
  englishGap: boolean;
  salaryMinUsd: number | null;
  salaryMaxUsd: number | null;
};

const MAX_LIST = 200;

function clampHalf(n: number): number {
  const c = Math.min(10, Math.max(0, n));
  return Math.round(c * 2) / 2;
}

function deltaOf(adjustments: readonly AffinityAdjustment[], rules: readonly string[]): number {
  let total = 0;
  for (const a of adjustments.slice(0, MAX_LIST)) {
    if (rules.includes(a.rule) && Number.isFinite(a.delta)) total += a.delta;
  }
  return total;
}

function hasRule(adjustments: readonly AffinityAdjustment[], rules: readonly string[]): boolean {
  return adjustments.slice(0, MAX_LIST).some((a) => rules.includes(a.rule));
}

/** Nivel de una barra según su puntaje (0 a 10). */
export function affinityLevel(score: number): AffinityLevel {
  if (score >= 7.5) return "high";
  if (score >= 5.5) return "mid";
  if (score >= 3.5) return "low";
  return "far";
}

function make(key: AffinityKey, raw: number | null): AffinityItem {
  if (raw === null) return { key, score: null, level: null };
  const score = clampHalf(raw);
  return { key, score, level: affinityLevel(score) };
}

const LOCATION_BASE: Record<string, number> = { ok: 10, riesgo: 5, no: 0 };

export function affinityBreakdown(input: AffinityInput): AffinityItem[] {
  const items: AffinityItem[] = [];

  // Rol y habilidades: calces contra calces más faltas; el tope por disciplina suma su ajuste.
  const matches = input.matchFuerte.length;
  const gaps = input.gaps.length;
  items.push(
    make(
      "role_skills",
      matches + gaps === 0
        ? null
        : (10 * matches) / (matches + gaps) + deltaOf(input.adjustments, ["discipline_cap"]),
    ),
  );

  // Seniority: años pedidos y topes por título; sin ninguno de los dos no hay datos.
  const seniorityRules = ["years_penalty", "years_gap_penalty", "title_cap"];
  items.push(
    make(
      "seniority",
      input.yearsRequired === null && !hasRule(input.adjustments, seniorityRules)
        ? null
        : 10 + deltaOf(input.adjustments, seniorityRules),
    ),
  );

  // Ubicación y modalidad: lo que dijo la evaluación más los ajustes por residencia.
  const locBase = input.locationOk === null ? undefined : LOCATION_BASE[input.locationOk];
  items.push(
    make(
      "location",
      locBase === undefined
        ? null
        : locBase + deltaOf(input.adjustments, ["residencia_exigida", "pais_excluido"]),
    ),
  );

  // Idioma: sin mención del inglés no hay datos; con mención, 10 menos penalizaciones o brecha.
  const eng = input.englishRequired;
  items.push(
    make(
      "language",
      eng === null || eng === "no_menciona"
        ? null
        : 10 + deltaOf(input.adjustments, ["english_fluent_penalty"]) - (input.englishGap ? 4 : 0),
    ),
  );

  // Sueldo: solo si el aviso lo informa. Los avisos del piso salen de riesgos y bloqueadores.
  if (input.salaryMinUsd || input.salaryMaxUsd) {
    const texts = [...input.riesgos.slice(0, MAX_LIST), ...input.bloqueadores.slice(0, MAX_LIST)];
    const belowMax = texts.some((t) => /por debajo del piso/i.test(t));
    const belowStart = texts.some((t) => /empieza abajo de tu piso/i.test(t));
    items.push(make("salary", belowMax ? 2 : belowStart ? 6 : 10));
  }

  return items;
}
