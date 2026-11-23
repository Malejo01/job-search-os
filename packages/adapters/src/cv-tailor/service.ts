import type { Db } from "@job-search-os/db";
import {
  err,
  ok,
  verifyCvTailor,
  type CvDocument,
  type CvTailorJob,
  type CvTailorOutput,
  type CvTailorRejectReason,
  type CvTailorVerified,
  type Result,
} from "@job-search-os/pipeline";
import { randomUUID } from "node:crypto";
import type { Logger } from "../logger";
import type { LlmClient } from "../llm/types";
import { generateCvTailor } from "./generate";
import { releaseCvTailorReservation, reserveCvTailor, type CvTailorCaps } from "./reserve";

/**
 * Orquestación de la versión adaptada: reserva de cupo y gasto, llamada al modelo, verificación por código y
 * liberación de la reserva. Quien llama cae a la versión por código ante cualquier error: este servicio nunca
 * devuelve texto del modelo sin verificar.
 */
export type CvTailorDeps = {
  llm: LlmClient;
  /** Conexión de servicio: las reservas y los topes miran `llm_calls` de todas las personas. */
  reserveDb: Db;
  caps?: CvTailorCaps;
  now?: () => Date;
  newId?: () => string;
  /** Skills del catálogo: una que aparezca en una viñeta y no esté en su entrada descarta la versión. */
  knownTerms?: readonly string[];
  logger?: Logger;
};

export type CvTailorFailure =
  | { kind: "daily_limit" }
  /** Tope de gasto global o de la persona. */
  | { kind: "capped" }
  | { kind: "llm_failed" }
  /** El modelo respondió pero la verificación descartó la versión. */
  | { kind: "rejected"; reason: CvTailorRejectReason };

export type CvTailorResult = {
  /** Lo que propuso el modelo (ya validado); sirve para volver a verificar sin gastar otra llamada. */
  proposal: CvTailorOutput;
  verified: CvTailorVerified;
  model: string;
};

export async function tailorCv(
  deps: CvTailorDeps,
  input: { userId: string; cv: CvDocument; job: CvTailorJob },
): Promise<Result<CvTailorResult, CvTailorFailure>> {
  const { userId } = input;
  const requestId = (deps.newId ?? randomUUID)();
  const log = deps.logger?.child({ user_id: userId, request_id: requestId });

  const reservation = await reserveCvTailor(deps.reserveDb, {
    ...deps.caps,
    userId,
    requestId,
    ...(deps.now ? { now: deps.now } : {}),
  });
  if (!reservation.ok) {
    log?.info({ reason: reservation.reason }, "versión adaptada frenada");
    return err(reservation.reason === "daily_limit" ? { kind: "daily_limit" } : { kind: "capped" });
  }

  try {
    const generated = await generateCvTailor(deps.llm, {
      userId,
      requestId,
      cv: input.cv,
      job: input.job,
    });
    if (!generated.ok) {
      log?.warn({ llm_kind: generated.error.llmKind }, "sin versión adaptada");
      return err({ kind: "llm_failed" });
    }
    const verified = verifyCvTailor(input.cv, generated.value.output, {
      ...(deps.knownTerms ? { knownTerms: deps.knownTerms } : {}),
    });
    if (!verified.ok) {
      // Solo el motivo: nunca el texto que escribió el modelo
      log?.warn(
        { reason: verified.error.reason, ref: verified.error.ref, detail: verified.error.detail },
        "versión adaptada descartada",
      );
      return err({ kind: "rejected", reason: verified.error.reason });
    }
    return ok({
      proposal: generated.value.output,
      verified: verified.value,
      model: generated.value.model,
    });
  } finally {
    await releaseCvTailorReservation(deps.reserveDb, reservation.reservationId);
  }
}
