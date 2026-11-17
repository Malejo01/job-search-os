import type { Db } from "@job-search-os/db";
import {
  buildCvDiagnosis,
  cvIssueViews,
  cvReviewCvText,
  cvReviewHeading,
  cvReviewOutputSchema,
  cvReviewPromptVars,
  detectCvInjection,
  profileAgentDailyCapUsd,
  profileAgentWindows,
  type CvCoachSignedIssues,
  type CvIssueView,
  type CvReviewContext,
} from "@job-search-os/pipeline";
import type { PromptRef } from "@job-search-os/prompts";
import { CV_CHAT_DEADLINE_MS, cvChatLabel } from "../../cv-chat/ids";
import type { LlmClient } from "../../llm/types";
import type { Logger } from "../../logger";
import {
  CV_REVIEW_TASK,
  releaseCvCoachReservation,
  reserveCvCoachStep,
  type CvCoachReject,
} from "../reserve";
import { signCvCoachIssues } from "./sign";

/**
 * Diagnóstico del coach de CV (ADR-038 §4, R12-8). Orquesta, fallando cerrado en cada paso:
 * `AUTH_SECRET` (sin firma no hay lista) → texto del CV confirmado y `detectCvInjection` (con inyección NO
 * se llama al modelo: queda el diagnóstico de datos) → reserva del paso `review` con lock (topes del coach y
 * del agente de perfil) → `cv_review` con timeout → validación, brechas de datos, orden y recorte
 * (`buildCvDiagnosis`, pipeline) → firma de la lista → textos de plantilla.
 *
 * El flag (`cvCoachAllowed`), la sesión y el ticket del agente de perfil los resuelve la ruta antes de
 * llamar acá; `flowId` llega ya verificado. Lo confirmado (`ctx.items`) lo lee la ruta con RLS: al modelo va
 * el CV confirmado, nunca el texto crudo (ADR-008).
 *
 * No guarda nada: en la base queda `llm_calls` (tarea, tokens, costo, `label = cv:<flowId>`, sin textos).
 * Logs: `user_id`, `run_id` (el `flowId`), códigos y conteos; nunca el CV, la salida del modelo ni citas.
 */
export const CV_REVIEW_PROMPT: PromptRef = "cv_review@v1";

export type CvReviewErrorCode =
  "secret_unavailable" | "usage_unavailable" | "capped" | "timeout" | "llm_failed";

export type CvReviewError = { code: CvReviewErrorCode; cap?: CvCoachReject };

export type CvReviewRunInput = {
  /** Siempre de la sesión. */
  userId: string;
  /** Del ticket del agente de perfil, ya verificado por la ruta. */
  flowId: string;
  ctx: CvReviewContext;
};

type ReserveFn = typeof reserveCvCoachStep;
type ReleaseFn = typeof releaseCvCoachReservation;

export type CvReviewDeps = {
  /** Conexión de servicio: los topes de USD son globales y ven `llm_calls` de todos. */
  db: Db;
  llm: LlmClient;
  logger: Logger;
  now: () => Date;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Para los tests sin base. */
  reserve?: ReserveFn;
  release?: ReleaseFn;
};

export type CvReviewOk = {
  /** Lista firmada: el navegador la guarda en `jso:coach:issues` y la devuelve en cada turno. */
  signed: CvCoachSignedIssues;
  /** Lo que ve la persona: textos de plantilla, en el mismo orden que `signed.issues`. */
  views: CvIssueView[];
  heading: string;
  /** `false` si no se llamó al modelo (inyección detectada o CV vacío): solo brechas de datos. */
  usedModel: boolean;
};

export async function runCvReview(
  input: CvReviewRunInput,
  deps: CvReviewDeps,
): Promise<{ ok: true; value: CvReviewOk } | { ok: false; error: CvReviewError }> {
  const env = deps.env ?? process.env;
  const label = cvChatLabel(input.flowId);
  const log = deps.logger.child({
    user_id: input.userId,
    run_id: input.flowId,
    task: CV_REVIEW_TASK,
  });
  const fail = (code: CvReviewErrorCode, cap?: CvCoachReject) => {
    log.warn({ code, ...(cap ? { cap } : {}) }, "cv_review_rechazado");
    return { ok: false as const, error: cap ? { code, cap } : { code } };
  };
  const secret = env.AUTH_SECRET;
  if (!secret) return fail("secret_unavailable");

  const finish = (proposed: Parameters<typeof buildCvDiagnosis>[1], usedModel: boolean) => {
    const issues = buildCvDiagnosis(input.ctx, proposed);
    const signed = signCvCoachIssues(
      secret,
      input.userId,
      { flowId: input.flowId, target: input.ctx.target, issues },
      deps.now().getTime(),
    );
    if (!signed) return fail("secret_unavailable");
    log.info(
      {
        code: "ok",
        used_model: usedModel,
        proposed: proposed?.length ?? 0,
        issues: issues.length,
        from_data: issues.filter((i) => i.source === "data").length,
        quotes: issues.filter((i) => i.quote !== null).length,
      },
      "cv_review_ok",
    );
    return {
      ok: true as const,
      value: {
        signed,
        views: cvIssueViews(signed.issues, input.ctx),
        heading: cvReviewHeading(input.ctx.target),
        usedModel,
      },
    };
  };

  // 1. CV vacío: no hay nada que revisar con el modelo
  const cvText = cvReviewCvText(input.ctx);
  if (cvText.length === 0) return finish(null, false);

  // 2. Inyección en el CV confirmado: no se llama al modelo (y no se gasta). El orden y los tipos los
  //    sigue decidiendo el código: quedan las brechas de datos
  const injection = detectCvInjection(cvText);
  if (injection.hit) {
    log.warn({ signals: injection.signals }, "cv_review_inyeccion");
    return finish(null, false);
  }

  // 3. Topes y reserva, bajo lock por persona
  const now = deps.now();
  let reservationId: string;
  try {
    const reservation = await (deps.reserve ?? reserveCvCoachStep)(deps.db, {
      userId: input.userId,
      label,
      step: "review",
      now,
      daySince: profileAgentWindows(now).daySince,
      dailyCapUsd: profileAgentDailyCapUsd(env),
    });
    if (!reservation.ok) return fail("capped", reservation.reject);
    reservationId = reservation.reservationId;
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    return fail("usage_unavailable");
  }

  // 4. Modelo, con timeout. La reserva se suelta siempre y nunca tapa el resultado
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? CV_CHAT_DEADLINE_MS);
  let result: Awaited<ReturnType<LlmClient["generateStructured"]>> | null;
  try {
    result = await deps.llm.generateStructured(
      CV_REVIEW_TASK,
      cvReviewOutputSchema,
      cvReviewPromptVars(input.ctx),
      { userId: input.userId, promptVersion: CV_REVIEW_PROMPT, label, signal: controller.signal },
    );
  } catch {
    result = null;
  } finally {
    clearTimeout(timer);
    const release = deps.release ?? releaseCvCoachReservation;
    if (!(await release(deps.db, { userId: input.userId, reservationId }))) {
      log.warn({}, "cv_review_reserva_sin_borrar");
    }
  }
  if (result === null) return fail(timedOut ? "timeout" : "llm_failed");
  if (!result.ok) {
    if (result.error.kind === "aborted" && timedOut) return fail("timeout");
    log.warn({ llm_kind: result.error.kind }, "cv_review_llm");
    return fail("llm_failed");
  }
  // El cliente ya validó contra el esquema; se vuelve a validar acá para tener el tipo y fallar cerrado
  const parsed = cvReviewOutputSchema.safeParse(result.value.object);
  if (!parsed.success) return fail("llm_failed");
  return finish(parsed.data.issues, true);
}
