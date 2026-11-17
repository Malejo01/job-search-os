/**
 * Validador de la pregunta que redacta el modelo en `cv_coach_turn` (ADR-038 §2, D1). Puro. Nada del modelo
 * llega a pantalla sin pasar por acá: si la pregunta no cumple TODAS las reglas, se usa la plantilla de
 * respaldo del tipo de problema (`templates.ts`). Reglas:
 *
 * - una sola línea, entre 10 y 220 caracteres, con «?»;
 * - sin dígitos (las preguntas con fechas las arma el código); solo se toleran los del nombre del ancla,
 *   escrito tal cual figura en el CV («Proyecto 1»);
 * - sin links ni emails (`hasLinkOrEmail`);
 * - sin datos sensibles (`SENSITIVE_QUESTION_RE` y la lista amplia de `coachQuestionIsSensitive`);
 * - sin instrucciones escondidas (`detectCvInjection`) ni caracteres invisibles;
 * - sin nombres propios ni tecnologías que no estén en el CV confirmado ni en lo que dijo la persona
 *   (`cvRejectReasons` contra esas fuentes);
 * - con el ancla del problema (empresa, proyecto, skill o sección).
 */
import { detectCvInjection } from "../../cv/injection";
import { cvRejectReasons, hasLinkOrEmail } from "../../cv-out/verify";
import type { CvIssue } from "../schemas";
import {
  coachIssueAnchor,
  coachQuestionSources,
  mentionsAnchor,
  type CoachAnchor,
  type CvCoachTurnContext,
} from "./context";
import {
  COACH_TEMPLATE_MAX_CHARS,
  COACH_TEMPLATE_MIN_CHARS,
  coachQuestionIsSensitive,
  renderCoachFallback,
  type CoachFallbacks,
} from "./templates";

export type CoachQuestionReason =
  | "vacia"
  | "varias_lineas"
  | "invisibles"
  | "muy_corta"
  | "muy_larga"
  | "sin_signo_de_pregunta"
  | "con_digitos"
  | "con_link_o_email"
  | "dato_sensible"
  | "instruccion"
  | "nombre_ajeno"
  | "sin_ancla";

const LINE_BREAK_RE = new RegExp("[\\r\\n\\u0085\\u2028\\u2029]");
// Control, invisibles y marcas bidi (construido con RegExp para no escribir los caracteres en el fuente)
const INVISIBLE_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u00AD\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF]",
);
const NAME_REASONS = new Set(["name_not_in_answers", "technology_not_in_answers"]);

function withoutAnchorNames(q: string, anchor: CoachAnchor): string {
  let out = q;
  for (const n of [...anchor.names].sort((a, b) => b.length - a.length)) {
    out = out.split(n).join(" ");
  }
  return out;
}

/** Primer motivo por el que la pregunta no sirve, o `null` si sirve. */
export function coachQuestionProblem(
  draft: string | null | undefined,
  input: { anchor: CoachAnchor; sources: readonly string[] },
): CoachQuestionReason | null {
  if (draft === null || draft === undefined || draft.trim() === "") return "vacia";
  if (LINE_BREAK_RE.test(draft.trim())) return "varias_lineas";
  if (INVISIBLE_RE.test(draft)) return "invisibles";
  const q = draft.replace(/\s+/g, " ").trim();
  if (q.length < COACH_TEMPLATE_MIN_CHARS) return "muy_corta";
  if (q.length > COACH_TEMPLATE_MAX_CHARS) return "muy_larga";
  if (!q.includes("?")) return "sin_signo_de_pregunta";
  // Un nombre del ancla con números («Proyecto 1») no cuenta: es el dato confirmado, no una cifra nueva
  if (/\d/.test(withoutAnchorNames(q, input.anchor))) return "con_digitos";
  if (hasLinkOrEmail(q)) return "con_link_o_email";
  if (coachQuestionIsSensitive(q)) return "dato_sensible";
  if (detectCvInjection(q).hit) return "instruccion";
  const reasons = cvRejectReasons(q, input.sources, { maxChars: COACH_TEMPLATE_MAX_CHARS });
  if (reasons.some((r) => NAME_REASONS.has(r))) return "nombre_ajeno";
  if (!mentionsAnchor(q, input.anchor)) return "sin_ancla";
  return null;
}

export type CoachQuestion = {
  issueId: CvIssue["id"];
  text: string;
  /** `model` si pasó el validador; `fallback` si es la plantilla. */
  source: "model" | "fallback";
  /** Por qué se descartó la del modelo (`null` si pasó o si no hubo borrador). */
  rejected: CoachQuestionReason | null;
  /** Es una repregunta sobre el mismo problema. */
  followUp: boolean;
};

/**
 * La pregunta que ve la persona para `issue`: el borrador del modelo si pasa el validador; si no, la
 * plantilla de respaldo (pregunta o repregunta) del tipo de problema.
 */
export function resolveCoachQuestion(input: {
  draft: string | null | undefined;
  issue: CvIssue;
  followUp: boolean;
  ctx: CvCoachTurnContext;
  fallbacks: CoachFallbacks;
  /** Lo que escribió la persona en este turno (cuenta como fuente de nombres). */
  messages: readonly string[];
}): CoachQuestion {
  const anchor = coachIssueAnchor(input.issue, input.ctx);
  const base = { issueId: input.issue.id, followUp: input.followUp };
  if (input.draft !== null && input.draft !== undefined) {
    const sources = coachQuestionSources(input.ctx, input.messages);
    const reason = coachQuestionProblem(input.draft, { anchor, sources });
    if (reason === null) {
      return {
        ...base,
        text: input.draft.replace(/\s+/g, " ").trim(),
        source: "model",
        rejected: null,
      };
    }
    return { ...base, text: fallbackText(input, anchor), source: "fallback", rejected: reason };
  }
  return { ...base, text: fallbackText(input, anchor), source: "fallback", rejected: null };
}

function fallbackText(
  input: { issue: CvIssue; followUp: boolean; ctx: CvCoachTurnContext; fallbacks: CoachFallbacks },
  anchor: CoachAnchor,
): string {
  return renderCoachFallback(
    input.fallbacks,
    input.issue.type,
    { variant: anchor.variant, value: anchor.value },
    input.followUp,
    input.ctx.target,
  );
}
