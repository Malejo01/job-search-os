import { neutralizeDelimiters } from "./input";

/**
 * Variables de los prompts del simulador. Todo lo que viene de afuera (aviso, pregunta, respuesta) va en un
 * bloque delimitado como dato; el texto de la persona o del aviso no puede cerrar el bloque.
 */
export const INTERVIEW_SENIORITIES = [
  "trainee",
  "junior",
  "semi_senior",
  "senior",
  "lead",
] as const;
export type InterviewSeniority = (typeof INTERVIEW_SENIORITIES)[number];

export const INTERVIEW_SENIORITY_LABELS: Record<InterviewSeniority, string> = {
  trainee: "Trainee",
  junior: "Junior",
  semi_senior: "Semi senior",
  senior: "Senior",
  lead: "Líder",
};

export const INTERVIEW_JOB_DESCRIPTION_MAX_CHARS = 2500;
const FIELD_MAX_CHARS = 160;

export type InterviewContext =
  | { kind: "job"; title: string; company: string; description: string | null }
  | { kind: "career"; career: string; seniority: InterviewSeniority };

const oneLine = (text: string): string =>
  neutralizeDelimiters(text.replace(/\s+/g, " ").trim()).slice(0, FIELD_MAX_CHARS);

/** Bloque `<<<CONTEXTO>>>` con lo que se sabe del puesto. */
export function buildInterviewContextBlock(ctx: InterviewContext): string {
  const lines =
    ctx.kind === "career"
      ? [`Carrera: ${oneLine(ctx.career)}`, `Nivel: ${INTERVIEW_SENIORITY_LABELS[ctx.seniority]}`]
      : [
          `Puesto: ${oneLine(ctx.title)}`,
          `Empresa: ${oneLine(ctx.company)}`,
          `Descripción:\n${
            ctx.description && ctx.description.trim() !== ""
              ? neutralizeDelimiters(ctx.description.trim()).slice(
                  0,
                  INTERVIEW_JOB_DESCRIPTION_MAX_CHARS,
                )
              : "(sin descripción)"
          }`,
        ];
  return `<<<CONTEXTO>>>\n${lines.join("\n")}\n<<<FIN CONTEXTO>>>`;
}

export function buildQuestionsPromptVars(ctx: InterviewContext): { context: string } {
  return { context: buildInterviewContextBlock(ctx) };
}

export function buildFeedbackPromptVars(input: {
  context: InterviewContext;
  question: string;
  /** Ya pasó por `prepareInterviewAnswer`. */
  answer: string;
}): { context: string; question: string; answer: string } {
  return {
    context: buildInterviewContextBlock(input.context),
    question: `<<<PREGUNTA>>>\n${neutralizeDelimiters(input.question)}\n<<<FIN PREGUNTA>>>`,
    answer: `<<<RESPUESTA>>>\n${neutralizeDelimiters(input.answer)}\n<<<FIN RESPUESTA>>>`,
  };
}
