import {
  buildFeedbackPromptVars,
  buildQuestionsPromptVars,
  err,
  InterviewFeedbackOutputSchema,
  InterviewQuestionsOutputSchema,
  interviewFeedbackWire,
  interviewQuestionsWire,
  ok,
  type InterviewContext,
  type InterviewFeedbackOutput,
  type Result,
} from "@job-search-os/pipeline";
import type { LlmClient } from "../llm/types";
import { interviewLabel } from "./reserve";
import { INTERVIEW_QUESTIONS_TASK } from "./starts";

/** Tareas de `model_routing` y versiones de prompt del simulador. */
export { INTERVIEW_QUESTIONS_TASK };
export const INTERVIEW_FEEDBACK_TASK = "interview_feedback";
export const INTERVIEW_QUESTIONS_PROMPT = "interview_questions@v1";
export const INTERVIEW_FEEDBACK_PROMPT = "interview_feedback@v1";

/** El detalle del error del cliente LLM no sale de acá: puede citar el aviso o la respuesta. */
export type InterviewLlmError = { kind: "llm_failed"; task: string; llmKind: string };

/**
 * Pide las 5 preguntas. El resultado ya pasó la validación estricta del cliente (cinco preguntas, largo
 * acotado): nada del modelo llega a la base sin ese paso.
 */
export async function generateInterviewQuestions(
  llm: LlmClient,
  input: { userId: string; sessionId: string; context: InterviewContext; signal?: AbortSignal },
): Promise<Result<{ questions: string[]; model: string }, InterviewLlmError>> {
  const r = await llm.generateStructured(
    INTERVIEW_QUESTIONS_TASK,
    InterviewQuestionsOutputSchema,
    buildQuestionsPromptVars(input.context),
    {
      userId: input.userId,
      promptVersion: INTERVIEW_QUESTIONS_PROMPT,
      label: interviewLabel(input.sessionId),
      wire: interviewQuestionsWire,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  if (!r.ok) {
    return err({ kind: "llm_failed", task: INTERVIEW_QUESTIONS_TASK, llmKind: r.error.kind });
  }
  return ok({ questions: r.value.object.questions, model: r.value.model });
}

/** Evalúa una respuesta (ya limpia y recortada) a una de las preguntas. */
export async function generateInterviewFeedback(
  llm: LlmClient,
  input: {
    userId: string;
    sessionId: string;
    context: InterviewContext;
    question: string;
    answer: string;
    signal?: AbortSignal;
  },
): Promise<Result<{ feedback: InterviewFeedbackOutput; model: string }, InterviewLlmError>> {
  const r = await llm.generateStructured(
    INTERVIEW_FEEDBACK_TASK,
    InterviewFeedbackOutputSchema,
    buildFeedbackPromptVars({
      context: input.context,
      question: input.question,
      answer: input.answer,
    }),
    {
      userId: input.userId,
      promptVersion: INTERVIEW_FEEDBACK_PROMPT,
      label: interviewLabel(input.sessionId),
      wire: interviewFeedbackWire,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  if (!r.ok) {
    return err({ kind: "llm_failed", task: INTERVIEW_FEEDBACK_TASK, llmKind: r.error.kind });
  }
  return ok({ feedback: r.value.object, model: r.value.model });
}
