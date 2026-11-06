/**
 * Repreguntas del chat de CV (R4-16). El código decide si un tema de experiencia quedó corto (`dates`,
 * `duties` vagas o `achievement` en null) y cuántas veces se repregunta (tope `CV_FOLLOWUP_MAX`); el modelo
 * solo propone el texto de la repregunta, que el código valida o reemplaza por una plantilla fija. Si la
 * persona dice «no tengo» / «no sé» se acepta y se sigue. Todo puro: sin I/O ni fecha implícita.
 */
import { cleanCvText, foldCvText } from "../cv-out/verify";
import type { CvChatState, CvTopic } from "./state";

/** Repreguntas máximas por tema antes de pasar al siguiente. */
export const CV_FOLLOWUP_MAX = 2;

export type CvFollowUpReason = "dates" | "duties" | "achievement";

const DECLINED_RE =
  /^(no[\s.,!]*$|no tengo|no se\b|no recuerdo|no me acuerdo|no hay\b|no aplica|ninguno|ninguna|nada\b|ni idea|prefiero no|saltear)/;

/** ¿La persona dijo que no tiene el dato o no lo sabe? Se acepta y se sigue. */
export function cvDeclined(message: string): boolean {
  return DECLINED_RE.test(
    foldCvText(message)
      .trim()
      .replace(/^[¿¡"'\s]+/, ""),
  );
}

/**
 * Datos personales sensibles que el chat nunca debe copiar ni preguntar (estado civil, hijos, religión,
 * afiliación política o sindical, orientación, nacimiento, embarazo). Busca DECLARACIONES sobre la persona
 * («soy casada», «tengo dos hijos», «estoy afiliado al sindicato»), no palabras sueltas: un empleador
 * («Sindicato de Comercio», «Colegio Religioso») o una tarea («cuidado de hijos de pacientes») son datos
 * de trabajo legítimos y no se tiran.
 */
const SENSITIVE_RE =
  /estado civil|\bsoy (casad|solter|divorciad|viud)[oa]\b|\b(casad|solter|divorciad|viud)[oa] (y|con)\b|\b(tengo|mis?) (\w+ )?hij[oa]s?\b|\bmi religion\b|\bsoy (catolic|evangelic|judi|musulman)[oa]\b|\bsoy ateo\b|\bsoy atea\b|afiliad[oa] (al|a un|a una) (partido|sindicato|gremio)|afiliacion (politica|sindical|partidaria)|orientacion sexual|\bestoy embarazad|fecha de nacimiento|\bnaci (el|en)\b/;

/**
 * Para preguntas, la lista es AMPLIA (palabras sueltas, aunque sea una pregunta indirecta): el chat nunca
 * pregunta por estado civil, hijos, religión, afiliación, orientación, nacimiento, embarazo, edad, salud,
 * política ni nacionalidad.
 */
const SENSITIVE_QUESTION_RE =
  /estado civil|casad[oa]|solter[oa]|divorciad[oa]|viud[oa]|\bhij[oa]s?\b|religi|afiliad[oa]|afiliaci|sindic|orientacion sexual|embaraz|fecha de nacimiento|\bnaci[oó]\b|edad|salud|enferm|discapacid|politic|sexual|nacionalidad/;

export function hasSensitiveCvData(text: string): boolean {
  return SENSITIVE_RE.test(foldCvText(text));
}

const FALLBACKS: Record<CvFollowUpReason, string> = {
  dates:
    "Para dejar bien las fechas, ¿me decís en qué mes y año empezaste y, si ya terminó, hasta cuándo? Si seguís ahí, avisame.",
  duties:
    "Quiero entender mejor tu día a día. ¿Podés contarme con un poco más de detalle qué hacías en ese trabajo? Con una o dos tareas más alcanza.",
  achievement:
    "¿Hubo algo concreto que hayas logrado ahí, aunque sea chico? Si no se te ocurre, no pasa nada y seguimos.",
};

export function cvFollowUpFallback(reason: CvFollowUpReason): string {
  return FALLBACKS[reason];
}

/**
 * Repregunta que se le muestra a la persona: el borrador del modelo si es una pregunta corta, sin números ni
 * datos sensibles; si no, la plantilla fija del tema. Nada del modelo llega a pantalla sin pasar por acá.
 */
export function safeFollowUpQuestion(
  draft: string | null | undefined,
  reason: CvFollowUpReason,
): string {
  const clean = cleanCvText(draft ?? "", 220, false);
  const ok =
    clean.length >= 10 &&
    clean.includes("?") &&
    !/\d/.test(clean) &&
    !SENSITIVE_QUESTION_RE.test(foldCvText(clean));
  return ok ? clean : FALLBACKS[reason];
}

const wordsOf = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * ¿Al tema recién respondido le falta algo clave? Se llama con el estado ya actualizado por `applyCvAnswer`.
 * `null` si no hay que repreguntar: el tema no es de experiencia, no se respondió bien, ya se llegó al tope,
 * la persona dijo «no tengo» / «no sé», o no falta nada.
 */
export function decideCvFollowUp(
  s: CvChatState,
  topic: CvTopic,
  message: string,
): CvFollowUpReason | null {
  if (topic.workIndex === null) return null;
  if (topic.kind !== "dates" && topic.kind !== "duties" && topic.kind !== "achievement")
    return null;
  if (!s.answered.includes(topic.key)) return null;
  if ((s.followUps[topic.key] ?? 0) >= CV_FOLLOWUP_MAX) return null;
  if (cvDeclined(message)) return null;
  const w = s.works[topic.workIndex];
  if (!w) return null;
  switch (topic.kind) {
    case "dates":
      return w.startMonth === null || (w.endMonth === null && !w.isCurrent) ? "dates" : null;
    case "duties":
      return w.duties.some((d) => wordsOf(d) >= 4) ? null : "duties";
    case "achievement":
      return w.achievement === null ? "achievement" : null;
  }
}

/**
 * Cierra el turno de un tema: decide si hay repregunta y deja el estado listo. Con repregunta, el tema queda
 * abierto (`nextCvTopic` lo devuelve de nuevo) con el texto vigente en `followUp`; sin ella, el tema queda
 * respondido. `draft` es lo que propuso el modelo (sin confiar): pasa por `safeFollowUpQuestion`.
 */
export function resolveCvFollowUp(
  s: CvChatState,
  topic: CvTopic,
  message: string,
  draft: string | null | undefined,
): CvChatState {
  const asked = s.followUps[topic.key] ?? 0;
  const done = (state: CvChatState): CvChatState => ({ ...state, followUp: null });
  if (!s.answered.includes(topic.key)) {
    // La respuesta a una repregunta no se pudo leer: se queda con lo que ya había y se sigue
    return asked > 0 ? done({ ...s, answered: [...s.answered, topic.key] }) : s;
  }
  const reason = decideCvFollowUp(s, topic, message);
  if (reason === null) return done(s);
  return {
    ...s,
    answered: s.answered.filter((k) => k !== topic.key),
    followUps: { ...s.followUps, [topic.key]: asked + 1 },
    followUp: { key: topic.key, question: safeFollowUpQuestion(draft, reason) },
  };
}
