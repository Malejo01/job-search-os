import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  createLogger,
  createPgQueue,
  evaluateJobNow,
  spendCapReason,
  USER_CAP_MESSAGE,
} from "@job-search-os/adapters";
import { after } from "next/server";
import { serviceLlm } from "./llm-service";

/** Mensajes para la UI por tipo de tope (la URL lleva solo el código, nunca el texto). */
export const CAP_MESSAGES = {
  user: `${USER_CAP_MESSAGE[0]!.toUpperCase()}${USER_CAP_MESSAGE.slice(1)}: la oferta queda en la cola y se evalúa cuando se libere tu cupo.`,
  global:
    "Se alcanzó el tope diario de gasto del modelo: la oferta queda en la cola y se evalúa más tarde.",
} as const;
export type CapKind = keyof typeof CAP_MESSAGES;

/**
 * Como `evaluateInBackground`, pero antes mira los topes de gasto (global y del usuario) y, si
 * alguno está superado, NO evalúa y devuelve cuál (`CapKind`) para mostrarlo en la UI (el mensaje
 * de la cola queda pending para el cron cuando baje el gasto). null = se programó la evaluación.
 */
export async function evaluateInBackgroundOrExplain(
  userId: string,
  jobId: string,
): Promise<CapKind | null> {
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const reason = await spendCapReason(db, { userId });
    if (reason) return reason;
  } catch (e) {
    // Si el chequeo falla, no se frena: evaluateJobNow vuelve a chequear dentro del `after`
    createLogger({ user_id: userId, job_id: jobId }).warn(
      { err: e instanceof Error ? e.message : String(e) },
      "no se pudo chequear el tope antes de evaluar",
    );
  } finally {
    await close();
  }
  evaluateInBackground(userId, jobId);
  return null;
}

/**
 * Evaluación inmediata al pegar JD (JS-027). Corre después de responder (`after`), así la
 * persona no espera al modelo: la oferta aparece en /jobs como "evaluando" y la vista se
 * actualiza sola cuando termina. Usa la conexión de servicio, como el cron, porque escribe
 * evaluations y llm_calls; el dueño del job ya se verificó con RLS al guardar el JD.
 * Si el tope de gasto está superado o el modelo falla, el mensaje queda en la cola para el cron.
 */
export function evaluateInBackground(userId: string, jobId: string): void {
  after(async () => {
    const logger = createLogger({ user_id: userId, job_id: jobId, trigger: "pegar_jd" });
    const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    try {
      const result = await evaluateJobNow(jobId, {
        db,
        llm: serviceLlm(db, logger),
        queue: createPgQueue(db),
        logger,
      });
      if (!result.ran) logger.info({ reason: result.reason }, "evaluación inmediata no corrió");
    } catch (e) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        "evaluación inmediata falló: queda para el cron",
      );
    } finally {
      await close();
    }
  });
}
