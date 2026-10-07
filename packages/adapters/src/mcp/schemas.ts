import { JOB_STATUSES, type JobEvent } from "@job-search-os/pipeline";
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

export const pasteJdInput = z.object({ id: z.string().uuid(), text: z.string().min(200) });

export const addJobInput = z.object({
  title: z.string().min(3),
  company: z.string().min(1),
  url: z.string().url().optional(),
  location: z.string().optional(),
  modality: z.enum(["remoto", "hibrido", "presencial", "desconocida"]).default("desconocida"),
  jd_text: z.string().min(200).optional(),
  salary_min_usd: z.number().int().min(0).optional(),
  salary_max_usd: z.number().int().min(0).optional(),
  candidates: z.number().int().min(0).optional(),
});

export const marketSummaryInput = z.object({ top: z.number().int().min(1).max(30).default(8) });

export const candidateProfileInput = z.object({ job_id: z.string().uuid().optional() });

export const listAnswersInput = z.object({
  query: z.string().optional(),
  lang: z.enum(ANSWER_LANGS).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const saveAnswerInput = z.object({
  question: z.string().min(3),
  answer: z.string().min(1),
  lang: z.enum(ANSWER_LANGS),
  job_id: z.string().uuid().optional(),
});

export const saveApplicationAnswersInput = z.object({
  job_id: z.string().uuid(),
  qa: z
    .array(z.object({ question: z.string().min(1), answer: z.string().min(1) }))
    .min(1)
    .max(60),
});

export const emptyInput = z.object({});
