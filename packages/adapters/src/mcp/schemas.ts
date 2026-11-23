import {
  JOB_STATUSES,
  MAX_ANSWER_CHARS,
  MAX_ANSWER_QUERY_CHARS,
  MAX_ANSWER_QUESTION_CHARS,
  MAX_JD_INPUT_CHARS,
  MAX_JOB_FIELD_CHARS,
  type JobEvent,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { ANSWER_LANGS } from "../applicant/context";

/**
 * Esquemas de entrada de las tools del MCP. Ninguno acepta `userId`: el usuario sale siempre de
 * resolveMcpUserId() en el servidor, nunca de lo que mande el chat (SEC-03).
 */
export const listJobsInput = z.object({
  score_min: z.number().min(0).max(10).optional(),
  status: z.enum([...JOB_STATUSES, "todas"]).optional(),
  limit: z.number().int().min(1).max(50).default(15),
});

export const getJobInput = z.object({ id: z.string().uuid() });

/** `manualEvents` son los eventos que la persona puede disparar (MANUAL_EVENTS de la app web). */
export function setStatusInput(manualEvents: readonly [JobEvent, ...JobEvent[]]) {
  return z.object({ id: z.string().uuid(), event: z.enum(manualEvents) });
}

export const pasteJdInput = z.object({
  id: z.string().uuid(),
  text: z.string().min(200).max(MAX_JD_INPUT_CHARS),
});

export const addJobInput = z.object({
  title: z.string().min(3).max(MAX_JOB_FIELD_CHARS),
  company: z.string().min(1).max(MAX_JOB_FIELD_CHARS),
  url: z.string().url().max(2_048).optional(),
  location: z.string().max(MAX_JOB_FIELD_CHARS).optional(),
  modality: z.enum(["remoto", "hibrido", "presencial", "desconocida"]).default("desconocida"),
  jd_text: z.string().min(200).max(MAX_JD_INPUT_CHARS).optional(),
  salary_min_usd: z.number().int().min(0).optional(),
  salary_max_usd: z.number().int().min(0).optional(),
  candidates: z.number().int().min(0).optional(),
});

export const marketSummaryInput = z.object({ top: z.number().int().min(1).max(30).default(8) });

export const candidateProfileInput = z.object({ job_id: z.string().uuid().optional() });

export const listAnswersInput = z.object({
  query: z.string().max(MAX_ANSWER_QUERY_CHARS).optional(),
  lang: z.enum(ANSWER_LANGS).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const saveAnswerInput = z.object({
  question: z.string().min(3).max(MAX_ANSWER_QUESTION_CHARS),
  answer: z.string().min(1).max(MAX_ANSWER_CHARS),
  lang: z.enum(ANSWER_LANGS),
  job_id: z.string().uuid().optional(),
});

/**
 * Total de caracteres (preguntas más respuestas) de un formulario por llamada. El cuerpo del pedido
 * tiene tope de 256 KB (`api/mcp/route.ts`): a 3 bytes por carácter, 60.000 caracteres entran con
 * margen. Un formulario más largo se guarda en dos llamadas. El máximo por campo sigue igual que en
 * la web: una sola respuesta del tope pasa.
 */
const MAX_APPLICATION_ANSWERS_TOTAL_CHARS = 60_000;

export const saveApplicationAnswersInput = z.object({
  job_id: z.string().uuid(),
  qa: z
    .array(
      z.object({
        question: z.string().min(1).max(MAX_ANSWER_QUESTION_CHARS),
        answer: z.string().min(1).max(MAX_ANSWER_CHARS),
      }),
    )
    .min(1)
    .max(60)
    .refine(
      (qa) =>
        qa.reduce((n, p) => n + p.question.length + p.answer.length, 0) <=
        MAX_APPLICATION_ANSWERS_TOTAL_CHARS,
      {
        message: `el total de preguntas y respuestas pasa ${MAX_APPLICATION_ANSWERS_TOTAL_CHARS} caracteres: guardá el formulario en varias llamadas`,
      },
    ),
});

export const emptyInput = z.object({});
