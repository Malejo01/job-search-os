import {
  buildCvTailorPromptVars,
  CvTailorOutputSchema,
  cvTailorWire,
  err,
  ok,
  type CvDocument,
  type CvTailorJob,
  type CvTailorOutput,
  type Result,
} from "@job-search-os/pipeline";
import type { LlmClient } from "../llm/types";
import { cvTailorLabel, CV_TAILOR_TASK } from "./reserve";

/** Versión del prompt. El nombre del modelo no está acá: sale de `model_routing`. */
export const CV_TAILOR_PROMPT = "cv_tailor@v1";

/** El detalle del error del cliente LLM no sale de acá: puede citar la oferta o la respuesta. */
export type CvTailorLlmError = { kind: "llm_failed"; llmKind: string };

/**
 * Pide la propuesta. El resultado ya pasó la validación estricta del esquema, pero todavía NO es el CV: lo
 * decide `verifyCvTailor`. Nada del modelo llega a la persona sin ese paso.
 */
export async function generateCvTailor(
  llm: LlmClient,
  input: {
    userId: string;
    requestId: string;
    cv: CvDocument;
    job: CvTailorJob;
    signal?: AbortSignal;
  },
): Promise<Result<{ output: CvTailorOutput; model: string }, CvTailorLlmError>> {
  const r = await llm.generateStructured(
    CV_TAILOR_TASK,
    CvTailorOutputSchema,
    buildCvTailorPromptVars({ cv: input.cv, job: input.job }),
    {
      userId: input.userId,
      promptVersion: CV_TAILOR_PROMPT,
      label: cvTailorLabel(input.requestId),
      wire: cvTailorWire,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );
  if (!r.ok) return err({ kind: "llm_failed", llmKind: r.error.kind });
  return ok({ output: r.value.object, model: r.value.model });
}
