/**
 * Flujo guiado del chat de CV (R33-03 y R33-04, C-06 a C-20). Lógica pura sobre `CvChatState`:
 * - el avance como lista de los 7 temas del informe (puesto, resumen, experiencia, estudios, habilidades,
 *   idiomas y links), con el actual marcado, los hechos tildados y los salteados a la vista;
 * - «Terminar y armar» solo con datos suficientes, y qué falta cuando se arma igual;
 * - volver a lo que se salteó;
 * - las respuestas de los temas nuevos (resumen y situaciones), que resuelve el código con las palabras de la
 *   persona, sin modelo: lo que el CV dice sale de lo que ella dijo.
 * Los textos que ve la persona viven en `apps/web/lib/textos-rediseno.ts`; acá solo hay claves.
 */
import { cleanCvText } from "../cv-out/verify";
import { cvDeclined, hasSensitiveCvData } from "./follow-up";
import { CV_SOFT_TOPICS, CV_SUMMARY_TOPICS } from "./state";
import {
  CV_CHAT_MAX_FAILURES,
  cvChatHistory,
  cvTopicSatisfied,
  nextCvTopic,
  type CvChatState,
  type CvTopic,
} from "./state";
import type { CvTopicKind } from "./schemas";

export const CV_UI_TOPICS = [
  "puesto",
  "resumen",
  "experiencia",
  "estudios",
  "habilidades",
  "idiomas",
  "links",
] as const;
export type CvUiTopic = (typeof CV_UI_TOPICS)[number];

export type CvUiTopicStatus = "done" | "current" | "skipped" | "pending";

const UI_OF: Record<CvTopicKind, CvUiTopic> = {
  target: "puesto",
  summary_experience: "resumen",
  summary_goal: "resumen",
  summary_strengths: "resumen",
  organization: "experiencia",
  title: "experiencia",
  dates: "experiencia",
  duties: "experiencia",
  achievement: "experiencia",
  more_work: "experiencia",
  education: "estudios",
  certifications: "estudios",
  skills: "habilidades",
  soft_lead: "habilidades",
  soft_problem: "habilidades",
  soft_clients: "habilidades",
  soft_organize: "habilidades",
  languages: "idiomas",
  links: "links",
};

/** A qué tema de la lista pertenece una pregunta. */
export const cvUiTopicOf = (topic: CvTopic): CvUiTopic => UI_OF[topic.kind];

const isWorkKey = (k: string): boolean => /^w\d+:/.test(k) || k.startsWith("more_work:");

/** ¿Una clave de tema del checklist es de este tema de la lista? */
function keyBelongs(ui: CvUiTopic, key: string): boolean {
  switch (ui) {
    case "puesto":
      return key === "target";
    case "resumen":
      return (CV_SUMMARY_TOPICS as readonly string[]).includes(key);
    case "experiencia":
      return isWorkKey(key);
    case "estudios":
      return key === "education" || key === "certifications";
    case "habilidades":
      return key === "skills" || (CV_SOFT_TOPICS as readonly string[]).includes(key);
    case "idiomas":
      return key === "languages";
    case "links":
      return key === "links";
  }
}

/** Claves salteadas de este tema: las de «Saltear esta pregunta» y las que se dieron por perdidas. */
function skippedKeys(s: CvChatState, ui: CvUiTopic): string[] {
  const lost = Object.entries(s.failures)
    .filter(([, n]) => n >= CV_CHAT_MAX_FAILURES)
    .map(([k]) => k);
  return [...new Set([...s.skipped, ...lost])].filter((k) => keyBelongs(ui, k));
}

function isDone(s: CvChatState, ui: CvUiTopic): boolean {
  const sat = (k: string) => cvTopicSatisfied(s, k);
  switch (ui) {
    case "puesto":
      return sat("target");
    case "resumen":
      return CV_SUMMARY_TOPICS.every(sat);
    case "experiencia": {
      if (!sat("target") || (s.guided && !CV_SUMMARY_TOPICS.every(sat))) return false;
      const next = nextCvTopic(s);
      return s.workDone || next === null || next.workIndex === null;
    }
    case "estudios":
      return sat("education") && sat("certifications");
    case "habilidades":
      return sat("skills") && (!s.guided || CV_SOFT_TOPICS.every(sat));
    case "idiomas":
      return sat("languages");
    case "links":
      return sat("links");
  }
}

/** Los temas que muestra la lista. Sin el flujo guiado no hay «resumen»: son los otros seis. */
function visibleTopics(s: CvChatState): readonly CvUiTopic[] {
  return s.guided ? CV_UI_TOPICS : CV_UI_TOPICS.filter((t) => t !== "resumen");
}

export type CvTopicProgress = { topic: CvUiTopic; status: CvUiTopicStatus };

/** Avance como lista de temas: el actual marcado, los hechos tildados, los salteados a la vista. */
export function cvTopicsProgress(s: CvChatState): CvTopicProgress[] {
  const next = nextCvTopic(s);
  const current = next ? cvUiTopicOf(next) : null;
  return visibleTopics(s).map((topic) => {
    if (!isDone(s, topic)) return { topic, status: topic === current ? "current" : "pending" };
    return { topic, status: skippedKeys(s, topic).length > 0 ? "skipped" : "done" };
  });
}

/** Temas que todavía no están hechos (salteados incluidos), en orden: es el «Falta: […]» de «Terminar y armar». */
export function cvPendingTopics(s: CvChatState): CvUiTopic[] {
  return cvTopicsProgress(s)
    .filter((t) => t.status !== "done")
    .map((t) => t.topic);
}

/**
 * ¿Hay datos suficientes para ofrecer «Terminar y armar»? Al menos una entrada para el CV: un trabajo con empresa
 * y cargo, un proyecto, un estudio o una certificación (lo ya confirmado antes del chat también cuenta).
 */
export function cvCanFinish(s: CvChatState): boolean {
  return cvChatHistory(s).length > 0;
}

/**
 * Vuelve a abrir lo que se salteó de un tema: se vuelve a preguntar sin tocar lo ya contestado. Si el tema no
 * tiene nada salteado, el estado queda igual.
 */
export function cvReopenTopic(s: CvChatState, ui: CvUiTopic): CvChatState {
  const keys = skippedKeys(s, ui);
  if (keys.length === 0) return s;
  const failures = { ...s.failures };
  for (const k of keys) delete failures[k];
  return {
    ...s,
    answered: s.answered.filter((k) => !keys.includes(k)),
    skipped: s.skipped.filter((k) => !keys.includes(k)),
    failures,
    followUp: null,
    // la experiencia se cierra con `workDone`: para volver a preguntarla se reabre
    workDone: ui === "experiencia" ? false : s.workDone,
  };
}

// ---------------------------------------------------------------------------
// Respuestas de los temas nuevos (sin modelo)
// ---------------------------------------------------------------------------

const SKIP_WORDS_RE = /^\s*(paso|saltear|saltearlo|skip)\s*[.!]*\s*$/i;

/** Los temas del resumen y las situaciones se resuelven con el código: nunca llaman al modelo. */
export function isCvLocalTopic(kind: CvTopicKind): boolean {
  return (
    (CV_SUMMARY_TOPICS as readonly string[]).includes(kind) ||
    (CV_SOFT_TOPICS as readonly string[]).includes(kind)
  );
}

/**
 * La respuesta a un tema nuevo: las palabras de la persona, sin links ni emails y con tope de largo. «No»,
 * «no tengo» o «saltear» no guardan nada, y un dato personal sensible tampoco: lo vacío queda vacío.
 */
export function cvLocalAnswer(message: string): { answer: string | null } {
  if (cvDeclined(message) || SKIP_WORDS_RE.test(message) || hasSensitiveCvData(message)) {
    return { answer: null };
  }
  const clean = cleanCvText(message, 220, true);
  return { answer: clean === "" ? null : clean };
}
