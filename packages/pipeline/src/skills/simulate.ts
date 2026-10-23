import { preScore } from "./prescore";

/**
 * Simulador «si aprendés X, entrás a N ofertas más» y ruta de estudio (diseño de la 121, §3; ticket
 * E3 de la C-3). Puro y determinista. «Entrar» a una oferta = su pre-score llega al umbral (7, el
 * mismo que usa «Hoy»). «Aprender X» = llevar X a nivel 2 (el pre-score no distingue 2 de 3).
 * No es el puntaje del modelo: es el pre-score, y la pantalla lo tiene que decir.
 */
export const SIMULATE_THRESHOLD = 7;
export const SIMULATE_TARGET_LEVEL = 2;
/** Con menos candidatas no se muestran números: «con pocas ofertas todavía no podemos decirlo». */
export const SIMULATE_MIN_CANDIDATES = 10;
/** Horas que se suponen para cerrar una skill sin `closure_hours` (y se marcan «estimado»). */
export const SIMULATE_DEFAULT_HOURS = 20;

export type SimCandidate = {
  id: string;
  flags: readonly string[];
  skills: readonly { slug: string; name: string; isMust: boolean }[];
  salaryMaxUsd: number | null;
};

export type SimInput = {
  candidates: readonly SimCandidate[];
  /** skill_levels de la persona por slug; sin fila = sin nivel (cuenta como desconocida). */
  levels: ReadonlyMap<string, number>;
  salaryFloorUsd: number | null;
};

export type SkillImpact = {
  slug: string;
  /** Candidatas que la piden, y cuántas como excluyente. */
  asks: number;
  asksMust: number;
  passNow: number;
  passAfter: number;
  delta: number;
  /** Hasta 3 ofertas que pasarían a entrar, por pre-score después (desc) y luego id. */
  exampleIds: string[];
};

function scoreOf(c: SimCandidate, levels: ReadonlyMap<string, number>, floor: number | null) {
  const skills = c.skills.map((s) => ({ ...s, level: levels.get(s.slug) ?? null }));
  const input = { flags: c.flags, skills, salaryMaxUsd: c.salaryMaxUsd, salaryFloorUsd: floor };
  return preScore(input).score;
}

function withLevels(levels: ReadonlyMap<string, number>, slugs: readonly string[]) {
  const next = new Map(levels);
  for (const slug of slugs) {
    next.set(slug, Math.max(next.get(slug) ?? 0, SIMULATE_TARGET_LEVEL));
  }
  return next;
}

/** Cuántas candidatas entran hoy y cuántas con esas skills a nivel 2. */
export function simulateSkills(input: SimInput, slugs: readonly string[]) {
  const after = withLevels(input.levels, slugs);
  let passNow = 0;
  let passAfter = 0;
  for (const c of input.candidates) {
    if (scoreOf(c, input.levels, input.salaryFloorUsd) >= SIMULATE_THRESHOLD) passNow += 1;
    if (scoreOf(c, after, input.salaryFloorUsd) >= SIMULATE_THRESHOLD) passAfter += 1;
  }
  return { total: input.candidates.length, passNow, passAfter };
}

export function simulateSkillImpact(input: SimInput, slug: string): SkillImpact {
  const after = withLevels(input.levels, [slug]);
  const floor = input.salaryFloorUsd;
  let asks = 0;
  let asksMust = 0;
  let passNow = 0;
  let passAfter = 0;
  const gained: { id: string; score: number }[] = [];
  for (const c of input.candidates) {
    const ask = c.skills.find((s) => s.slug === slug);
    if (ask) asks += 1;
    if (ask?.isMust) asksMust += 1;
    const now = scoreOf(c, input.levels, floor) >= SIMULATE_THRESHOLD;
    const later = scoreOf(c, after, floor);
    if (now) passNow += 1;
    if (later >= SIMULATE_THRESHOLD) passAfter += 1;
    if (!now && later >= SIMULATE_THRESHOLD) gained.push({ id: c.id, score: later });
  }
  gained.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const exampleIds = gained.slice(0, 3).map((g) => g.id);
  return { slug, asks, asksMust, passNow, passAfter, delta: passAfter - passNow, exampleIds };
}

export type RouteSkill = {
  slug: string;
  name: string;
  /** Horas que faltan para cerrarla; null o 0 = sin dato (se usa 20 y se marca estimado). */
  hours: number | null;
  /** Prioridad en el plan: desempata. */
  priority: number;
};

export type RouteStep = {
  slug: string;
  name: string;
  hours: number;
  estimated: boolean;
  /** Ofertas que suma en el momento en que se aprende (ya contando las anteriores). */
  delta: number;
  weekFrom: number;
  weekTo: number;
};

type RouteOption = { s: RouteSkill; rate: number };

/** Más ofertas por hora primero; después la prioridad del plan y el slug. */
function byRate(a: RouteOption, b: RouteOption): number {
  if (b.rate !== a.rate) return b.rate - a.rate;
  return b.s.priority - a.s.priority || a.s.slug.localeCompare(b.s.slug);
}

/**
 * Ruta de estudio greedy marginal: en cada paso elige la skill que más ofertas suma por hora sobre
 * los niveles ya «aprendidos», así dos skills que destraban la misma oferta no la cuentan dos veces.
 * Desempata por prioridad del plan y después por slug. Reparte las horas en semanas.
 */
export function buildStudyRoute(
  input: SimInput,
  skills: readonly RouteSkill[],
  hoursPerWeek: number,
): RouteStep[] {
  const perWeek = hoursPerWeek > 0 ? hoursPerWeek : 5;
  const pending = [...skills];
  const learned: string[] = [];
  const steps: RouteStep[] = [];
  let doneHours = 0;
  while (pending.length) {
    const base = simulateSkills(input, learned).passAfter;
    const options = pending.map((s) => {
      const estimated = !s.hours;
      const hours = s.hours || SIMULATE_DEFAULT_HOURS;
      const delta = simulateSkills(input, [...learned, s.slug]).passAfter - base;
      return { s, hours, estimated, delta, rate: delta / hours };
    });
    options.sort(byRate);
    const best = options[0]!;
    pending.splice(pending.indexOf(best.s), 1);
    learned.push(best.s.slug);
    const weekFrom = Math.floor(doneHours / perWeek) + 1;
    doneHours += best.hours;
    const weekTo = Math.max(weekFrom, Math.round(doneHours / perWeek));
    steps.push({
      slug: best.s.slug,
      name: best.s.name,
      hours: best.hours,
      estimated: best.estimated,
      delta: best.delta,
      weekFrom,
      weekTo,
    });
  }
  return steps;
}
