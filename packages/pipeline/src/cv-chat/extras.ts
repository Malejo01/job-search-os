/**
 * Extracción multi-campo del chat de CV (R12-2). El esquema de cada turno sigue siendo el del tema que
 * decidió el código, pero el modelo puede sumar `extras`: otros datos del mismo trabajo que la persona dijo
 * en el mensaje (empresa, cargo, fechas, tareas, logro) y proyectos, dichos en cualquier tema. Así
 * «empresa, cargo y fechas en un mensaje» no se vuelve a preguntar y los proyectos no se pierden.
 *
 * Reglas (todas del código, el modelo solo propone):
 * - cada extra pasa su propio esquema estricto; uno roto se descarta solo, sin tirar el turno;
 * - un extra con algo que el mensaje no dice (`extractionGrounded`) o con un dato sensible
 *   (`hasSensitiveCvData`) se descarta **entero**; el link de un proyecto tiene que estar copiado del
 *   mensaje y ser https;
 * - un extra nunca pisa un campo ya cargado (si choca, lo resuelve la pregunta de contradicción);
 * - el extra del mismo tema que se preguntó se ignora: para eso está la extracción del tema.
 * Puro: sin I/O.
 */
import { z } from "zod";
import { cvProjectLink, CV_PROJECT_LINK_MAX_CHARS } from "../cv-out/model";
import { foldCvText } from "../cv-out/verify";
import { hasSensitiveCvData } from "./follow-up";
import { extractionGrounded } from "./grounding";
import { MONTH, name, sentence, text } from "./schemas";
import {
  cvWorkKey,
  dedupe,
  setWork,
  withAnswered,
  type CvChatState,
  type CvProjectDraft,
  type CvTopic,
  type CvWorkDraft,
} from "./state";

/** Extras que se aplican por turno, como mucho. */
export const CV_EXTRAS_MAX = 10;
export const CV_CHAT_MAX_PROJECTS = 6;

const orderedDates = (v: { startMonth: string | null; endMonth: string | null }): boolean =>
  v.startMonth === null || v.endMonth === null || v.endMonth >= v.startMonth;

export const CV_EXTRA_SCHEMA = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("organization"), organization: name }),
  z.strictObject({ kind: z.literal("title"), title: name }),
  z
    .strictObject({
      kind: z.literal("dates"),
      startMonth: MONTH.nullable(),
      endMonth: MONTH.nullable(),
      isCurrent: z.boolean(),
    })
    .refine(orderedDates)
    .refine((v) => !v.isCurrent || v.endMonth === null),
  z.strictObject({ kind: z.literal("duties"), duties: z.array(sentence).min(1).max(4) }),
  z.strictObject({ kind: z.literal("achievement"), achievement: sentence }),
  z.strictObject({
    kind: z.literal("project"),
    name,
    role: name.nullable(),
    description: sentence.nullable(),
    stack: z.array(text(40)).max(8),
    link: z.string().max(CV_PROJECT_LINK_MAX_CHARS).nullable(),
  }),
]);
export type CvExtra = z.infer<typeof CV_EXTRA_SCHEMA>;
export type CvWorkExtra = Exclude<CvExtra, { kind: "project" }>;

/** Lista de extras del turno: opcional, y cada uno que no cumple su esquema queda en `null`. */
export const CV_EXTRAS_FIELD = z.array(CV_EXTRA_SCHEMA.nullable().catch(null)).default([]);

function grounded(extra: CvExtra, message: string): boolean {
  const { kind: _kind, ...data } = extra;
  if (extra.kind === "project" && extra.link !== null) {
    const link = cvProjectLink(extra.link);
    if (link === null || !foldCvText(message).includes(foldCvText(link))) return false;
    return extractionGrounded({ ...data, link: null }, message);
  }
  return extractionGrounded(data, message);
}

/** Extras que se pueden usar: válidos, anclados al mensaje y sin datos sensibles. */
export function usableCvExtras(extras: readonly (CvExtra | null)[], message: string): CvExtra[] {
  return extras
    .filter((e): e is CvExtra => e !== null)
    .filter((e) => grounded(e, message) && !hasSensitiveCvData(JSON.stringify(e)))
    .slice(0, CV_EXTRAS_MAX);
}

/** A qué trabajo van los extras de experiencia del turno, o `null` si a ninguno. */
function workTarget(s: CvChatState, topic: CvTopic): number | null {
  if (s.workDone) return null;
  // Puesto y primer trabajo en el mismo mensaje: el trabajo arranca con lo que ya dijo
  if (topic.kind === "target") return s.works.length === 0 ? 0 : null;
  if (topic.workIndex === null) return null;
  // «¿Otro trabajo?»: solo si dijo que sí (ya existe el borrador del trabajo nuevo)
  if (topic.kind === "more_work") return s.works.length > topic.workIndex ? topic.workIndex : null;
  return topic.workIndex;
}

const EMPTY_WORK: CvWorkDraft = {
  organization: null,
  title: null,
  startMonth: null,
  endMonth: null,
  isCurrent: false,
  duties: [],
  achievement: null,
};

function applyWorkExtra(s: CvChatState, i: number, e: CvWorkExtra): CvChatState {
  const w = s.works[i] ?? EMPTY_WORK;
  const done = (state: CvChatState): CvChatState => withAnswered(state, cvWorkKey(e.kind, i));
  switch (e.kind) {
    case "organization":
      return w.organization ? s : done(setWork(s, i, { organization: e.organization }));
    case "title":
      return w.title ? s : done(setWork(s, i, { title: e.title }));
    case "dates": {
      if (w.startMonth !== null || w.endMonth !== null || w.isCurrent) return s;
      const next = setWork(s, i, {
        startMonth: e.startMonth,
        endMonth: e.isCurrent ? null : e.endMonth,
        isCurrent: e.isCurrent,
      });
      // Solo cuenta como respondido si está completo: con inicio y con fin o «sigo ahí»
      return e.startMonth !== null && (e.endMonth !== null || e.isCurrent) ? done(next) : next;
    }
    case "duties":
      return done(setWork(s, i, { duties: dedupe([...w.duties, ...e.duties]).slice(0, 4) }));
    case "achievement":
      return w.achievement ? s : done(setWork(s, i, { achievement: e.achievement }));
  }
}

function addProject(s: CvChatState, e: Extract<CvExtra, { kind: "project" }>): CvChatState {
  const key = foldCvText(e.name);
  const i = s.projects.findIndex((p) => foldCvText(p.name) === key);
  if (i === -1) {
    if (s.projects.length >= CV_CHAT_MAX_PROJECTS) return s;
    const p: CvProjectDraft = {
      name: e.name,
      role: e.role,
      description: e.description,
      stack: dedupe(e.stack),
      link: e.link === null ? null : cvProjectLink(e.link),
    };
    return { ...s, projects: [...s.projects, p] };
  }
  // El mismo proyecto otra vez: completa lo que faltaba, no pisa lo que ya estaba
  const prev = s.projects[i]!;
  const merged: CvProjectDraft = {
    name: prev.name,
    role: prev.role ?? e.role,
    description: prev.description ?? e.description,
    stack: dedupe([...prev.stack, ...e.stack]).slice(0, 8),
    link: prev.link ?? (e.link === null ? null : cvProjectLink(e.link)),
  };
  const projects = [...s.projects];
  projects[i] = merged;
  return { ...s, projects };
}

/**
 * Aplica los extras ya filtrados (`usableCvExtras`) después de la extracción del tema. Los de experiencia
 * van al trabajo del turno y marcan su tema como respondido; los proyectos se suman en cualquier tema.
 */
export function applyCvExtras(
  s: CvChatState,
  topic: CvTopic,
  extras: readonly CvExtra[],
): CvChatState {
  let out = s;
  for (const e of extras) {
    if (e.kind === "project") {
      out = addProject(out, e);
      continue;
    }
    if (e.kind === topic.kind) continue;
    const i = workTarget(out, topic);
    if (i !== null) out = applyWorkExtra(out, i, e);
  }
  return out;
}
