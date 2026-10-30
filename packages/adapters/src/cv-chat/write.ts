/**
 * Redacción del CV (C-25, tarea `cv_write`): una llamada estructurada con las respuestas confirmadas. La salida
 * del modelo nunca va directo al CV: `applyCvWrite` (puro) compara cada viñeta y el resumen con las
 * respuestas de origen y descarta lo que traiga números, nombres o tecnologías nuevos.
 */
import {
  applyCvWrite,
  CV_WRITE_OUTPUT_SCHEMA,
  cvWriteVars,
  err,
  ok,
  type CvWriteInput,
  type CvWriteResult,
  type Result,
} from "@job-search-os/pipeline";
import type { LlmClient, LlmError } from "../llm";
import { cvChatLabel, cvChatSignal } from "./ids";

export const CV_WRITE_TASK = "cv_write";

export type CvWriteParams = {
  userId: string;
  conversationId: string;
  input: CvWriteInput;
  /** Nombres del catálogo de skills: una tecnología en minúsculas que no estaba en las respuestas se descarta. */
  knownTerms?: readonly string[];
  signal?: AbortSignal;
  /** Solo para tests: el deadline del paso (primario y respaldo juntos). Por defecto 50 s. */
  deadlineMs?: number;
};

export type CvWriteDrafted = CvWriteResult & {
  model: string;
  usedFallback: boolean;
  costUsd: number | null;
};

export async function runCvWrite(
  deps: { llm: LlmClient },
  p: CvWriteParams,
): Promise<Result<CvWriteDrafted, LlmError>> {
  const r = await deps.llm.generateStructured(
    CV_WRITE_TASK,
    CV_WRITE_OUTPUT_SCHEMA,
    cvWriteVars(p.input),
    {
      userId: p.userId,
      label: cvChatLabel(p.conversationId),
      signal: cvChatSignal(p.signal, p.deadlineMs),
    },
  );
  if (!r.ok) return err(r.error);
  const applied = applyCvWrite(
    p.input,
    r.value.object,
    p.knownTerms ? { knownTerms: p.knownTerms } : {},
  );
  return ok({
    ...applied,
    model: r.value.model,
    usedFallback: r.value.usedFallback,
    costUsd: r.value.costUsd,
  });
}
