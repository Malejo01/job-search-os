/**
 * Cierre del agente de perfil (ADR-034 §1, R10-5): la redacción del CV con `cv_write` y el verificador de
 * ADR-026 (`applyCvWrite`, dentro de `runCvWrite`). La tarea y su prompt no cambian; solo cambia el `label`,
 * que es `cv:<flowId>` para que el gasto de la charla (lectura, huecos y redacción) se sume junto.
 * La salida del modelo nunca llega al CV sin pasar por el verificador.
 */
import type { CvWriteInput, Result } from "@job-search-os/pipeline";
import type { LlmError } from "../../llm";
import { runCvWrite, type CvWriteDrafted } from "../../cv-chat/write";

export type ProfileAgentWriteParams = {
  userId: string;
  flowId: string;
  input: CvWriteInput;
  /** Nombres del catálogo de skills: una tecnología que el modelo nombra y la persona no dijo se descarta. */
  knownTerms?: readonly string[];
  signal?: AbortSignal;
  deadlineMs?: number;
};

export function runProfileAgentWrite(
  deps: Parameters<typeof runCvWrite>[0],
  p: ProfileAgentWriteParams,
): Promise<Result<CvWriteDrafted, LlmError>> {
  return runCvWrite(deps, {
    userId: p.userId,
    conversationId: p.flowId,
    input: p.input,
    ...(p.knownTerms ? { knownTerms: p.knownTerms } : {}),
    ...(p.signal ? { signal: p.signal } : {}),
    ...(p.deadlineMs !== undefined ? { deadlineMs: p.deadlineMs } : {}),
  });
}
