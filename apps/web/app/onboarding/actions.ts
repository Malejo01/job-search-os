"use server";

import {
  assignPoolToUser,
  createLogger,
  createPgQueue,
  evaluateJobNow,
  parseEnabledSources,
  parsePoolSources,
  recomputeMarketForUser,
  runExtraSourcesIngest,
  runGetOnBoardIngest,
  safeDbError,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { parseOnboarding, parsePoolLimits } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { upgradeLegacyInboundAddress } from "@/lib/inbound-address";
import { serviceLlm } from "@/lib/llm-service";
import { completeOnboarding, isOnboardingComplete } from "@/lib/onboarding";
import { requireUserId } from "@/lib/session";

/**
 * Guarda el onboarding (B2). Valida con Zod (parseOnboarding); si falla vuelve al formulario con
 * el nombre del campo, nunca con el valor. El usuario sale de la sesión, no del formulario.
 */
export async function saveOnboardingAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseOnboarding(raw);
  if (!parsed.ok) redirect(`/onboarding?error=${encodeURIComponent(parsed.field)}`);
  // Solo la primera vez dispara la ingesta: un POST repetido a la acción no la repite
  const wasComplete = await isOnboardingComplete(userId);
  const saved = await completeOnboarding(userId, parsed.value);
  if (!saved) redirect("/onboarding?error=perfil");
  // JS-095: la dirección derivada del id se cambia por una aleatoria (si ya lo es, no se toca)
  // Es accesorio: si falla, el onboarding sigue (la dirección se puede rotar desde Ajustes)
  try {
    await upgradeLegacyInboundAddress(userId);
  } catch {
    createLogger({ user_id: userId, task: "inbound_address" }).error(
      "no se pudo asignar la dirección de email entrante",
    );
  }
  // Así ve ofertas sin esperar al cron; si el onboarding ya estaba completo no se repite
  if (!wasComplete) scheduleFirstIngest(userId);
  redirect("/onboarding/skills");
}

/** Después de este tiempo desde que arranca el trabajo no se empieza otra evaluación inmediata. */
const FIRST_EVAL_BUDGET_MS = 90_000;

/**
 * Primeras ofertas de la persona, después de responder (el usuario no espera ni se entera si algo
 * falla). En orden:
 * 1. Si `getonboard` no está en POOL_SOURCES (el pool todavía está apagado), la ingesta por usuario
 *    de siempre, para no dejar a nadie sin ofertas; y las fuentes de INGEST_EXTRA_SOURCES.
 * 2. Asignación desde el pool global (`assignPoolToUser`): asigna y encola, no llama al modelo.
 * 3. Evaluación inmediata, en serie, de las primeras encoladas con los topes de siempre; si una
 *    vuelve por tope (global o del usuario) se corta y el resto queda en la cola para el cron.
 * 4. Primer mercado y plan (sin LLM).
 * La función corre dentro del maxDuration de /onboarding (120 s): 9 evaluaciones de ~3 s cada una
 * más la asignación entran de sobra.
 */
function scheduleFirstIngest(userId: string): void {
  after(async () => {
    const startedAt = Date.now();
    const logger = createLogger({ user_id: userId, task: "first_ingest" });
    let conn: ReturnType<typeof createDb> | null = null;
    try {
      conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
      const { db } = conn;
      const pools = parsePoolSources(process.env.POOL_SOURCES);
      if (!pools.enabled.includes("getonboard")) {
        try {
          await runGetOnBoardIngest({ db, logger, userId, sinceHours: 24 });
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: Get on Board falló");
        }
      }
      const { enabled } = parseEnabledSources(process.env.INGEST_EXTRA_SOURCES);
      if (enabled.length > 0) {
        try {
          await runExtraSourcesIngest({ db, logger, enabled, userId, sinceHours: 24 });
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: fuentes extra fallaron");
        }
      }
      // Ofertas del pool global para esta persona, y evaluación inmediata de las mejores
      let enqueuedJobIds: string[] = [];
      try {
        const { limits, invalid } = parsePoolLimits(process.env);
        if (invalid.length > 0) {
          logger.warn({ invalid }, "topes del pool inválidos: se usa el valor por defecto");
        }
        const assigned = await assignPoolToUser(db, userId, {
          limit: limits.firstAssignLimit,
          enqueueTop: limits.firstEvalTopN,
          // Un segundo envío no asigna ni encola de nuevo: descuenta lo asignado en las últimas 24 h
          deductLast24h: true,
          logger,
        });
        enqueuedJobIds = assigned.enqueuedJobIds;
        logger.info(
          { assigned: assigned.assigned, enqueued: assigned.enqueued },
          "primera ingesta: pool asignado",
        );
      } catch (e) {
        logger.error({ err: safeDbError(e) }, "primera ingesta: la asignación del pool falló");
      }
      if (enqueuedJobIds.length > 0) {
        try {
          const llm = serviceLlm(db, logger);
          const queue = createPgQueue(db);
          // En serie: cada una cuenta contra los topes de gasto antes de llamar al modelo
          for (const jobId of enqueuedJobIds) {
            // Reloj: pasado el tiempo, el resto queda en la cola para el cron (maxDuration 120 s)
            if (Date.now() - startedAt > FIRST_EVAL_BUDGET_MS) {
              logger.info("primera evaluación cortada por tiempo");
              break;
            }
            const jobLogger = createLogger({ user_id: userId, job_id: jobId, task: "first_eval" });
            const result = await evaluateJobNow(jobId, { db, llm, queue, logger: jobLogger });
            if (!result.ran && (result.reason === "cap" || result.reason === "user_cap")) {
              logger.info({ reason: result.reason }, "primera evaluación cortada por tope");
              break;
            }
          }
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: la evaluación inmediata falló");
        }
      }
      // Con las ofertas ya ingeridas: primer mercado y plan de la persona (sin LLM)
      try {
        await recomputeMarketForUser(db, { userId, inputsChanged: true });
      } catch (e) {
        logger.error({ err: safeDbError(e) }, "primera ingesta: el recálculo de mercado falló");
      }
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "primera ingesta no pudo arrancar");
    } finally {
      await conn?.close().catch(() => {});
    }
  });
}
