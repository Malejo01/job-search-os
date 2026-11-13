import { loadPrompt } from "@job-search-os/prompts";
import {
  err,
  ok,
  parseGapTemplates,
  type GapTemplateError,
  type GapTemplates,
  type Result,
} from "@job-search-os/pipeline";

/**
 * Plantillas de las preguntas de huecos (ADR-034 §1): `packages/prompts/profile_gaps.v1.md`. Las lee el
 * adaptador (el pipeline no hace I/O) y las valida el pipeline (`parseGapTemplates`). Se cargan una vez por
 * proceso: el archivo viaja con el código. Si el archivo falta o no valida, la charla de huecos no arranca
 * (falla cerrado): nunca se pregunta con un texto que nadie revisó.
 */
export const PROFILE_GAPS_PROMPT = "profile_gaps@v1" as const;

export type GapTemplatesError =
  { kind: "prompt"; detail: string } | { kind: "templates"; error: GapTemplateError };

let cached: GapTemplates | null = null;

export function loadGapTemplates(dir?: string): Result<GapTemplates, GapTemplatesError> {
  if (cached && dir === undefined) return ok(cached);
  const p = loadPrompt(PROFILE_GAPS_PROMPT, dir);
  if (!p.ok) return err({ kind: "prompt", detail: p.error.kind });
  const parsed = parseGapTemplates(p.value.template);
  if (!parsed.ok) return err({ kind: "templates", error: parsed.error });
  if (dir === undefined) cached = parsed.value;
  return ok(parsed.value);
}
