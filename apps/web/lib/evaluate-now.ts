import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { createLogger, createPgQueue, evaluateJobNow } from "@job-search-os/adapters";
import { after } from "next/server";
import { serviceLlm } from "./llm-service";

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
