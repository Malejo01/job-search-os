import { loadPrompt } from "@job-search-os/prompts";
import {
  err,
  ok,
  parseCoachFallbacks,
  type CoachFallbackError,
  type CoachFallbacks,
  type Result,
} from "@job-search-os/pipeline";

/**
 * Plantillas de respaldo del coach (ADR-038 §2): `packages/prompts/cv_coach_fallbacks.v1.md`. Las lee el
 * adaptador (el pipeline no hace I/O) y las valida el pipeline (`parseCoachFallbacks`). Se cargan una vez
 * por proceso. Si el archivo falta o no valida, el turno no corre (falla cerrado): nunca se pregunta con un
 * texto que nadie revisó.
 */
export const CV_COACH_FALLBACKS_PROMPT = "cv_coach_fallbacks@v1" as const;

export type CoachFallbacksError =
  { kind: "prompt"; detail: string } | { kind: "templates"; error: CoachFallbackError };

let cached: CoachFallbacks | null = null;

export function loadCoachFallbacks(dir?: string): Result<CoachFallbacks, CoachFallbacksError> {
  if (cached && dir === undefined) return ok(cached);
  const p = loadPrompt(CV_COACH_FALLBACKS_PROMPT, dir);
  if (!p.ok) return err({ kind: "prompt", detail: p.error.kind });
  const parsed = parseCoachFallbacks(p.value.template);
  if (!parsed.ok) return err({ kind: "templates", error: parsed.error });
  if (dir === undefined) cached = parsed.value;
  return ok(parsed.value);
}
