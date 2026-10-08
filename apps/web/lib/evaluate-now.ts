import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  createLogger,
  createPgQueue,
  evaluateJobNow,
  safeDbError,
  spendCapReason,
  USER_CAP_MESSAGE,
} from "@job-search-os/adapters";
import { after } from "next/server";
import { serviceLlm } from "./llm-service";
import { isOnboardingComplete } from "./onboarding";

/** Mensajes para la UI por tipo de tope (la URL lleva solo el código, nunca el texto). */
export const CAP_MESSAGES = {
  user: `${USER_CAP_MESSAGE[0]!.toUpperCase()}${USER_CAP_MESSAGE.slice(1)}: la oferta queda en la cola y se evalúa cuando se libere tu cupo.`,
  global:
    "Se alcanzó el tope diario de gasto del modelo: la oferta queda en la cola y se evalúa más tarde.",
} as const;
export type CapKind = keyof typeof CAP_MESSAGES;

/** Sin onboarding completo no se evalúa nada (JS-109): el MCP y las acciones no pasan por el gate del layout. */
export const ONBOARDING_MESSAGE = "Completá el onboarding para evaluar ofertas";

/** Por qué `evaluateInBackgroundOrExplain` no programó la evaluación. */
export type NotEvaluatedReason = CapKind | "onboarding" | "pendiente";

/** Un chequeo previo falló: no se programa nada y el mensaje queda en la cola (sin detalle del error). */
export const PENDING_MESSAGE =
  "La evaluación quedó pendiente: se hace en la próxima corrida automática.";

/** Texto para la UI o el MCP (sin montos) de cada motivo. */
export function notEvaluatedMessage(reason: NotEvaluatedReason): string {
  if (reason === "onboarding") return ONBOARDING_MESSAGE;
  if (reason === "pendiente") return PENDING_MESSAGE;
  return CAP_MESSAGES[reason];
}

/**
 * Como `evaluateInBackground`, pero antes mira el onboarding y los topes de gasto (global y del
 * usuario) y, si algo lo impide, NO evalúa y devuelve el motivo para mostrarlo en la UI (el
 * mensaje de la cola queda pending para el cron cuando baje el gasto). null = se programó la
 * evaluación.
 */
export async function evaluateInBackgroundOrExplain(
  userId: string,
  jobId: string,
): Promise<NotEvaluatedReason | null> {
  // Nunca lanza: los llamadores ya guardaron el dato (JD, fusión) y no deben mostrar un error por esto
  try {
    if (!(await isOnboardingComplete(userId))) return "onboarding";
    const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    try {
      const reason = await spendCapReason(db, { userId });
      if (reason) return reason;
    } finally {
      await close();
    }
  } catch (e) {
    createLogger({ user_id: userId, job_id: jobId }).error(
      { err: safeDbError(e) },
      "no se pudo chequear onboarding o tope antes de evaluar: queda para el cron",
    );
    return "pendiente";
  }
  try {
    scheduleEvaluation(userId, jobId);
  } catch (e) {
    createLogger({ user_id: userId, job_id: jobId }).error(
      { err: safeDbError(e) },
      "no se pudo programar la evaluación: queda para el cron",
    );
    return "pendiente";
  }
  return null;
}

/**
 * Evaluación inmediata al pegar JD (JS-027). Corre después de responder (`after`), así la
 * persona no espera al modelo: la oferta aparece en /jobs como "evaluando" y la vista se
 * actualiza sola cuando termina. Usa la conexión de servicio, como el cron, porque escribe
 * evaluations y llm_calls; el dueño del job ya se verificó con RLS al guardar el JD.
 * Si el tope de gasto está superado o el modelo falla, el mensaje queda en la cola para el cron.
 * Sin onboarding completo no evalúa (JS-109).
 */
export function evaluateInBackground(userId: string, jobId: string): void {
  scheduleEvaluation(userId, jobId, { checkOnboarding: true });
}

function scheduleEvaluation(
  userId: string,
  jobId: string,
  opts: { checkOnboarding?: boolean } = {},
): void {
  after(async () => {
    const logger = createLogger({ user_id: userId, job_id: jobId, trigger: "pegar_jd" });
    if (opts.checkOnboarding) {
      try {
        if (!(await isOnboardingComplete(userId))) {
          logger.info({ reason: "onboarding" }, "evaluación inmediata no corrió");
          return;
        }
      } catch (e) {
        logger.error(
          { err: safeDbError(e) },
          "no se pudo chequear el onboarding: queda para el cron",
        );
        return;
      }
    }
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
      logger.error({ err: safeDbError(e) }, "evaluación inmediata falló: queda para el cron");
    } finally {
      await close();
    }
  });
}
