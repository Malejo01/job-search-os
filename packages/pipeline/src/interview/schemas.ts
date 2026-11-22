import { z } from "zod";
import type { LlmWire } from "../evaluator/wire";

/**
 * Simulador de entrevistas: salidas del modelo. El modelo propone preguntas y puntúa una respuesta; el
 * código valida cada campo y decide qué se muestra. Un puntaje fuera de 0 a 10 es una salida rota: no se
 * recorta, falla la validación.
 */
export const INTERVIEW_QUESTION_COUNT = 5;
export const INTERVIEW_QUESTION_MIN_CHARS = 10;
export const INTERVIEW_QUESTION_MAX_CHARS = 280;
export const INTERVIEW_TIP_MAX_CHARS = 400;
export const INTERVIEW_EXAMPLE_MAX_CHARS = 600;

export const InterviewQuestionsOutputSchema = z.object({
  questions: z
    .array(z.string().trim().min(INTERVIEW_QUESTION_MIN_CHARS).max(INTERVIEW_QUESTION_MAX_CHARS))
    .length(INTERVIEW_QUESTION_COUNT),
});
export type InterviewQuestionsOutput = z.infer<typeof InterviewQuestionsOutputSchema>;

const Score = z.number().int().min(0).max(10);

export const InterviewFeedbackOutputSchema = z.object({
  clarity: Score,
  relevance: Score,
  star: Score,
  tip: z.string().trim().min(10).max(INTERVIEW_TIP_MAX_CHARS),
  example: z.string().trim().min(10).max(INTERVIEW_EXAMPLE_MAX_CHARS),
});
export type InterviewFeedbackOutput = z.infer<typeof InterviewFeedbackOutputSchema>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Recorta a `max` caracteres sin partir una palabra (salvo que no haya un espacio donde cortar). */
function clampText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let head = t.slice(0, max);
  if (/\s/.test(t.charAt(max))) return head.trimEnd();
  const lastSpace = head.search(/\s\S*$/);
  if (lastSpace > 0) return head.slice(0, lastSpace).trimEnd();
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head.trimEnd();
}

/**
 * Borde del modelo: algunos proveedores no imponen límites de largo ni de rango. Al modelo viaja el esquema
 * sin límites; lo que vuelve se normaliza (recorte de textos, cinco preguntas, puntajes redondeados) y
 * después corre la validación estricta de arriba.
 */
export const interviewQuestionsWire: LlmWire = {
  schema: z.object({ questions: z.array(z.string()) }),
  normalize(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.questions)) return raw;
    const questions = raw.questions
      .slice(0, INTERVIEW_QUESTION_COUNT)
      .map((q) => (typeof q === "string" ? clampText(q, INTERVIEW_QUESTION_MAX_CHARS) : q));
    return { ...raw, questions };
  },
};

export const interviewFeedbackWire: LlmWire = {
  schema: z.object({
    clarity: z.number(),
    relevance: z.number(),
    star: z.number(),
    tip: z.string(),
    example: z.string(),
  }),
  normalize(raw) {
    if (!isRecord(raw)) return raw;
    const out: Record<string, unknown> = { ...raw };
    for (const key of ["clarity", "relevance", "star"] as const) {
      const v = out[key];
      // Solo se redondea: fuera de 0 a 10 falla en el esquema estricto
      if (typeof v === "number" && Number.isFinite(v)) out[key] = Math.round(v);
    }
    if (typeof out.tip === "string") out.tip = clampText(out.tip, INTERVIEW_TIP_MAX_CHARS);
    if (typeof out.example === "string") {
      out.example = clampText(out.example, INTERVIEW_EXAMPLE_MAX_CHARS);
    }
    return out;
  },
};
