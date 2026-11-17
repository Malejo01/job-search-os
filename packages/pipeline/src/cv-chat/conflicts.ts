/**
 * Contradicciones en el chat de CV (R12-3). Si en un turno la persona dice algo que choca con lo que ya
 * dijo antes en la charla («febrero» y después «marzo»; dos cargos para el mismo trabajo) o con lo que ya
 * está confirmado en su historial, el código no elige: guarda la contradicción y la pregunta siguiente es
 * «¿Cuál dejo?» con dos opciones (plantilla en `questions.ts`, chips en la pantalla). Sin contradicción no
 * hay pregunta extra. Lo nuevo dicho en la charla no pisa lo anterior hasta que la persona elige.
 * Puro: sin I/O.
 */
import { foldCvText } from "../cv-out/verify";
import { cvMonthLabel, cvMonthName } from "./ack";
import { applyCvExtras, cvExtrasWorkIndex, type CvExtra } from "./extras";
import { setWork, withAnswered, type CvChatState, type CvTopic } from "./state";

export const CV_CONFLICT_FIELDS = ["title", "startMonth", "endMonth"] as const;
export type CvConflictField = (typeof CV_CONFLICT_FIELDS)[number];

export interface CvConflict {
  workIndex: number;
  field: CvConflictField;
  /** Lo que ya estaba: dicho antes en la charla, o confirmado en el historial. */
  previous: string;
  /** Lo que dijo ahora. */
  proposed: string;
  source: "said" | "confirmed";
}

export interface CvConflictOption {
  /** Texto del chip y de la respuesta que manda. */
  label: string;
  value: string;
}

const norm = (s: string): string => foldCvText(s).replace(/\s+/g, " ").trim();
const differs = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && norm(a) !== norm(b);

/** Clave en `answered` de una contradicción ya resuelta: no se vuelve a preguntar. */
const resolvedKey = (i: number, field: CvConflictField): string => `conflict:w${i}:${field}`;

export function cvConflictLabel(field: CvConflictField, value: string): string {
  return field === "title" ? value : cvMonthLabel(value);
}

/** Las dos opciones, primero lo que ya estaba. */
export function cvConflictOptions(c: CvConflict): [CvConflictOption, CvConflictOption] {
  return [
    { label: cvConflictLabel(c.field, c.previous), value: c.previous },
    { label: cvConflictLabel(c.field, c.proposed), value: c.proposed },
  ];
}

/**
 * La primera contradicción del turno, o `null`. `s` es el estado con la extracción del tema ya aplicada y
 * `extras` los que pasaron los controles (todavía sin aplicar).
 */
export function findCvConflict(
  s: CvChatState,
  topic: CvTopic,
  extras: readonly CvExtra[],
): CvConflict | null {
  const open = (i: number, field: CvConflictField): boolean =>
    !s.answered.includes(resolvedKey(i, field));

  // 1. Contra lo dicho antes en la charla: un extra que choca con un campo ya cargado
  const i = cvExtrasWorkIndex(s, topic);
  const w = i === null ? undefined : s.works[i];
  if (i !== null && w) {
    for (const e of extras) {
      if (e.kind === topic.kind) continue;
      const said = (field: CvConflictField, prev: string | null, next: string | null) =>
        open(i, field) && differs(prev, next)
          ? { workIndex: i, field, previous: prev!, proposed: next!, source: "said" as const }
          : null;
      const found =
        e.kind === "title"
          ? said("title", w.title, e.title)
          : e.kind === "dates"
            ? (said("startMonth", w.startMonth, e.startMonth) ??
              said("endMonth", w.isCurrent ? null : w.endMonth, e.endMonth))
            : null;
      if (found) return found;
    }
  }

  // 2. Contra lo confirmado en el historial: el mismo trabajo (misma empresa) con otro cargo u otras fechas
  const j = topic.workIndex ?? i;
  if (j === null) return null;
  const cw = applyCvExtras(s, topic, extras).works[j];
  if (!cw?.organization) return null;
  const confirmed = s.confirmed.find(
    (h) => h.kind === "trabajo" && norm(h.organization) === norm(cw.organization!),
  );
  if (!confirmed) return null;
  const pairs: [CvConflictField, string | null, string | null][] = [
    ["title", confirmed.title, cw.title],
    ["startMonth", confirmed.startMonth, cw.startMonth],
    ["endMonth", confirmed.endMonth, cw.isCurrent ? null : cw.endMonth],
  ];
  for (const [field, prev, next] of pairs) {
    if (open(j, field) && differs(prev, next)) {
      return { workIndex: j, field, previous: prev!, proposed: next!, source: "confirmed" };
    }
  }
  return null;
}

function pick(c: CvConflict, message: string): CvConflictOption | null {
  const options = cvConflictOptions(c);
  const m = norm(message)
    .replace(/[¿?¡!.,;:"'«»]/g, "")
    .trim();
  if (m === "") return null;
  const exact = options.find((o) => norm(o.label) === m || norm(o.value) === m);
  if (exact) return exact;
  const inside = options.filter((o) => m.includes(norm(o.label)));
  if (inside.length === 1) return inside[0]!;
  if (c.field !== "title") {
    // «marzo»: alcanza con el nombre del mes si una sola opción lo tiene
    const byMonth = options.filter((o) => {
      const name = cvMonthName(o.value);
      return name !== null && new RegExp(`\\b${name}\\b`).test(m);
    });
    if (byMonth.length === 1) return byMonth[0]!;
  }
  return null;
}

/**
 * Respuesta a «¿Cuál dejo?» (un chip o texto). Lo que no es ninguna de las dos opciones conserva lo que ya
 * estaba; un fin anterior al inicio (o al revés) tampoco se acepta. Cuenta un turno y no llama al modelo.
 */
export function resolveCvConflict(
  s: CvChatState,
  message: string,
): { state: CvChatState; ack: string | null } {
  const c = s.conflict;
  if (!c) return { state: s, ack: null };
  const [previous] = cvConflictOptions(c);
  let chosen = pick(c, message) ?? previous;
  const w = s.works[c.workIndex];
  if (w && c.field === "endMonth" && w.startMonth && chosen.value < w.startMonth) chosen = previous;
  if (w && c.field === "startMonth" && w.endMonth && chosen.value > w.endMonth) chosen = previous;
  const patch =
    c.field === "endMonth"
      ? { endMonth: chosen.value, isCurrent: false }
      : { [c.field]: chosen.value };
  const base = { ...s, conflict: null, turns: s.turns + 1 };
  const state = withAnswered(
    w ? setWork(base, c.workIndex, patch) : base,
    resolvedKey(c.workIndex, c.field),
  );
  return { state, ack: `Listo, dejo ${chosen.label}.` };
}
