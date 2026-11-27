"use server";

import {
  composeTailorProposal,
  CvTailorOutputSchema,
  CV_BULLET_MAX_CHARS,
  CV_MAX_BULLETS,
  type CvTailorChange,
  type CvTailorOutput,
  type TailorSuggestion,
} from "@job-search-os/pipeline";
import { z } from "zod";
import { isUuid } from "@/lib/ids";
import { activeSessionUserId } from "@/lib/session";
import { buildTailorPreview, type TailorPreview } from "./preview";
import { runCvTailorForJob, verifyTailorForSave, type CvTailorFallbackReason } from "./server";
import { offerBelongsTo, saveOfferVersion } from "./versions";

/**
 * Server Actions de la versión del CV adaptada con IA (R20-04, R34-02). La persona sale de la sesión, nunca del
 * pedido; lo que llega del navegador se valida con zod. Los errores vuelven como códigos cerrados: el texto que ve la
 * persona lo arma la pantalla, nunca una excepción ni lo que devolvió el modelo. Ante cualquier error la
 * pantalla sigue con la versión sin IA.
 */
export type TailorCvActionResult =
  | {
      ok: true;
      changed: boolean;
      changes: CvTailorChange[];
      preview: TailorPreview;
      /** Una tarjeta por cambio para aceptar, editar o descartar de a una. */
      suggestions: TailorSuggestion[];
      /** Ya verificada. Vuelve con las decisiones al guardar y el servidor la verifica otra vez. */
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
    suggestions: outcome.suggestions,
    proposal: outcome.proposal,
  };
}

const decisionSchema = z.discriminatedUnion("action", [
  z.strictObject({ id: z.string().min(1).max(40), action: z.enum(["accept", "discard"]) }),
  z.strictObject({
    id: z.string().min(1).max(40),
    action: z.literal("edit"),
    bullets: z.array(z.string().trim().min(1).max(CV_BULLET_MAX_CHARS)).max(CV_MAX_BULLETS),
  }),
]);

const saveSchema = z.strictObject({
  jobId: z.string().uuid(),
  proposal: CvTailorOutputSchema,
  decisions: z.array(decisionSchema).max(60),
});

export type SaveVersionResult =
  | { ok: true; replacedOldest: boolean }
  | {
      ok: false;
      error:
        | "unauthorized"
        | "bad_request"
        | "off"
        | "no_job"
        | "no_cv"
        | "stale"
        | "rejected"
        | "server";
      /** Entrada que no pasó la verificación (`experience-0`), si aplica. Nunca el texto. */
      ref?: string;
    };

/**
 * Guarda la versión adaptada con lo que la persona decidió (R34-02). Recompone la propuesta con sus decisiones,
 * la verifica de nuevo contra el CV de hoy (una edición que sume algo no declarado se rechaza) y recién ahí la
 * guarda como otra versión de esa oferta. El CV base no se toca.
 */
export async function saveTailorVersionAction(input: unknown): Promise<SaveVersionResult> {
  const userId = await activeSessionUserId();
  if (!userId) return { ok: false, error: "unauthorized" };
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success || !isUuid(parsed.data.jobId)) return { ok: false, error: "bad_request" };
  const { jobId, proposal, decisions } = parsed.data;
  try {
    // La oferta tiene que ser de la persona (RLS + filtro por user_id)
    if (!(await offerBelongsTo(userId, jobId))) return { ok: false, error: "no_job" };
    const composed = composeTailorProposal(proposal, decisions);
    if (composed.entries.length === 0 && composed.skills.length === 0) {
      return { ok: false, error: "bad_request" };
    }
    const verified = await verifyTailorForSave(userId, composed);
    if (!verified.ok) {
      return { ok: false, error: verified.reason, ...(verified.ref ? { ref: verified.ref } : {}) };
    }
    const saved = await saveOfferVersion(userId, jobId, verified.proposal);
    return saved.ok
      ? { ok: true, replacedOldest: saved.replacedOldest }
      : { ok: false, error: "bad_request" };
  } catch {
    return { ok: false, error: "server" };
  }
}
