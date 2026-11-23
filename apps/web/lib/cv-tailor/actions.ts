"use server";

import type { CvTailorChange, CvTailorOutput } from "@job-search-os/pipeline";
import { z } from "zod";
import { activeSessionUserId } from "@/lib/session";
import { buildTailorPreview, type TailorPreview } from "./preview";
import { runCvTailorForJob, type CvTailorFallbackReason } from "./server";

/**
 * Server Action de la versión del CV adaptada con IA (R20-04). La persona sale de la sesión, nunca del pedido; lo
 * que llega del navegador se valida con zod. Los errores vuelven como códigos cerrados: el texto que ve la
 * persona lo arma la pantalla, nunca una excepción ni lo que devolvió el modelo. Ante cualquier error la
 * pantalla sigue con la versión sin IA.
 */
export type TailorCvActionResult =
  | {
      ok: true;
      changed: boolean;
      changes: CvTailorChange[];
      preview: TailorPreview;
      /** Ya verificada. La descarga la manda de vuelta y el servidor la verifica otra vez. */
      proposal: CvTailorOutput;
    }
  | { ok: false; error: CvTailorFallbackReason | "unauthorized" | "bad_request" };

const inputSchema = z.strictObject({ jobId: z.string().uuid() });

export async function tailorCvAction(input: unknown): Promise<TailorCvActionResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "bad_request" };
  const outcome = await runCvTailorForJob(userId, parsed.data.jobId);
  if (outcome.kind === "fallback") return { ok: false, error: outcome.reason };
  return {
    ok: true,
    changed: outcome.changed,
    changes: outcome.changes,
    preview: buildTailorPreview(outcome.document),
    proposal: outcome.proposal,
  };
}
