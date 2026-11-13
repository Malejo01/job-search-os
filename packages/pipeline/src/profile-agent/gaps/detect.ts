/**
 * Detección de huecos (ADR-034 §1). Puro: recibe las filas de `career_history` y de las skills de la persona
 * (el servidor las lee con RLS) y devuelve los temas que faltan, en orden. El temario lo decide el código, no
 * el modelo, y se recalcula en cada pedido a partir de lo que hay en la base: el navegador solo dice cuáles
 * temas ya cerró (`answered`), y eso solo puede saltear preguntas, nunca sumar.
 */
import type { HistoryKind } from "../../cv-out/history";
import { gapKeySchema, type GapTopic, type ProfileGapState } from "../schemas";

export const GAP_MAX_TOPICS = 12;
export const GAP_MAX_SKILL_TOPICS = 3;
/** Una tarea cuenta como concreta si tiene al menos esta cantidad de palabras. */
export const GAP_MIN_DUTY_WORDS = 4;

export type GapHistoryRow = {
  id: string;
  kind: HistoryKind;
  organization: string;
  title: string;
  startMonth: string | null;
  endMonth: string | null;
  bullets: readonly string[];
};

/** `level` 0 = «nunca lo usé», 1 = «hice un tutorial o curso», 2 y 3 = lo usó. */
export type GapSkillRow = { slug: string; name: string; level: 0 | 1 | 2 | 3 };

export type GapTopicRef = {
  key: string;
  topic: GapTopic;
  /** Fila de `career_history` a la que apunta (temas de trabajo). */
  historyId: string | null;
  organization: string | null;
  /** Skill de la taxonomía (`skill_level`). */
  skillSlug: string | null;
  skillName: string | null;
};

const wordsOf = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/** ¿Hay al menos una tarea concreta (varias palabras)? */
export function hasConcreteDuty(bullets: readonly string[]): boolean {
  return bullets.some((b) => wordsOf(b) >= GAP_MIN_DUTY_WORDS);
}

/** ¿Algún texto trae un número (un resultado medible)? */
export function hasResultNumber(bullets: readonly string[]): boolean {
  return bullets.some((b) => /\d/.test(b));
}

export function gapKeyForHistory(historyId: string, topic: GapTopic): string {
  return `${historyId}:${topic}`;
}

export function gapKeyForSkill(slug: string): string {
  return `skill:${slug}:skill_level`;
}

/**
 * Temas que le faltan al perfil, en este orden: por cada trabajo, fechas, tareas y logro; después las
 * skills que la persona declaró con nivel «tutorial». Solo trabajos (los estudios no se repreguntan).
 * Las claves que no entran en `gapKeySchema` se dejan afuera (un `slug` raro no rompe la charla).
 */
export function detectGaps(
  history: readonly GapHistoryRow[],
  skills: readonly GapSkillRow[],
): GapTopicRef[] {
  const out: GapTopicRef[] = [];
  const push = (ref: GapTopicRef): void => {
    if (gapKeySchema.safeParse(ref.key).success) out.push(ref);
  };
  for (const row of history) {
    if (row.kind !== "trabajo") continue;
    const base = {
      historyId: row.id,
      organization: row.organization,
      skillSlug: null,
      skillName: null,
    };
    if (row.startMonth === null) {
      push({ ...base, key: gapKeyForHistory(row.id, "dates"), topic: "dates" });
    }
    if (!hasConcreteDuty(row.bullets)) {
      push({ ...base, key: gapKeyForHistory(row.id, "duties"), topic: "duties" });
    }
    if (!hasResultNumber(row.bullets)) {
      push({ ...base, key: gapKeyForHistory(row.id, "achievement"), topic: "achievement" });
    }
  }
  const weak = skills.filter((k) => k.level === 1).slice(0, GAP_MAX_SKILL_TOPICS);
  const skillRefs: GapTopicRef[] = [];
  for (const k of weak) {
    const ref: GapTopicRef = {
      key: gapKeyForSkill(k.slug),
      topic: "skill_level",
      historyId: null,
      organization: null,
      skillSlug: k.slug,
      skillName: k.name,
    };
    if (KEY_SKILL_RE.test(ref.key) && gapKeySchema.safeParse(ref.key).success) skillRefs.push(ref);
  }
  // las skills tienen lugar reservado: los trabajos no las dejan afuera
  return [...out.slice(0, GAP_MAX_TOPICS - skillRefs.length), ...skillRefs];
}

const KEY_HISTORY_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(dates|duties|achievement)$/;
const KEY_SKILL_RE = /^skill:([A-Za-z0-9_-]{1,60}):skill_level$/;

/**
 * El tema que nombra una clave que volvió del navegador, armado con lo que hay HOY en la base. No exige que
 * siga siendo un hueco: una tarjeta ya confirmada puede haberlo resuelto mientras se repregunta sobre el mismo
 * tema. `null` si la clave no tiene la forma, o si la fila (o la skill) no es de esta persona.
 */
export function gapRefFromKey(
  key: string,
  history: readonly GapHistoryRow[],
  skills: readonly GapSkillRow[],
): GapTopicRef | null {
  const h = KEY_HISTORY_RE.exec(key);
  if (h) {
    const row = history.find((r) => r.id === h[1] && r.kind === "trabajo");
    if (!row) return null;
    return {
      key,
      topic: h[2] as GapTopic,
      historyId: row.id,
      organization: row.organization,
      skillSlug: null,
      skillName: null,
    };
  }
  const k = KEY_SKILL_RE.exec(key);
  if (k) {
    const skill = skills.find((x) => x.slug === k[1]);
    if (!skill) return null;
    return {
      key,
      topic: "skill_level",
      historyId: null,
      organization: null,
      skillSlug: skill.slug,
      skillName: skill.name,
    };
  }
  return null;
}

/** Los huecos con el tema abierto (repregunta) incluido aunque ya no figure como hueco. */
export function withOpenGap(gaps: readonly GapTopicRef[], open: GapTopicRef | null): GapTopicRef[] {
  return open === null || gaps.some((g) => g.key === open.key) ? [...gaps] : [open, ...gaps];
}

/** Los temas que quedan: los que la persona todavía no cerró. */
export function pendingGaps(all: readonly GapTopicRef[], state: ProfileGapState): GapTopicRef[] {
  const closed = new Set(state.answered);
  return all.filter((g) => !closed.has(g.key));
}

/** El tema vigente: el que quedó abierto (repregunta) si sigue pendiente; si no, el primero que queda. */
export function currentGap(
  all: readonly GapTopicRef[],
  state: ProfileGapState,
): GapTopicRef | null {
  const pending = pendingGaps(all, state);
  if (state.current) {
    const open = pending.find((g) => g.key === state.current);
    if (open) return open;
  }
  return pending[0] ?? null;
}
