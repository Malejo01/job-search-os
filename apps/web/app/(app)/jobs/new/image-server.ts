import {
  countTaskCallsSince,
  createLogger,
  EXTRACT_IMAGE_TASK,
  extractJobFromImage,
  safeDbError,
  spendCapReason,
  type ExtractImageOutcome,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { serviceLlm } from "@/lib/llm-service";

/**
 * Cableado del servidor para «cargar una oferta desde una imagen» (R6-3). La lógica está en
 * `extractJobFromImage` (adapters); acá solo se arma la conexión de servicio (que ve `llm_calls` de
 * todos, como la evaluación inmediata) y se la cierra siempre.
 *
 * La imagen vive solo en memoria durante esta llamada: no se escribe en la base ni en un blob, y
 * los logs llevan `user_id` y el código del resultado, nunca los bytes ni el texto leído.
 */
export async function extractJobImageForUser(
  userId: string,
  image: Uint8Array,
): Promise<ExtractImageOutcome> {
  const logger = createLogger({ user_id: userId, trigger: "oferta_desde_imagen" });
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const outcome = await extractJobFromImage(
      {
        llm: serviceLlm(conn.db, logger),
        countSince: (since) =>
          countTaskCallsSince(conn.db, { userId, task: EXTRACT_IMAGE_TASK, since }),
        capReason: () => spendCapReason(conn.db, { userId }),
      },
      { userId, image },
    );
    logger.info(
      {
        ok: outcome.ok,
        code: outcome.ok ? null : outcome.code,
        offers: outcome.ok ? outcome.offers.length : 0,
      },
      "imagen leída",
    );
    return outcome;
  } catch (e) {
    logger.error({ err: safeDbError(e) }, "imagen: falló la lectura");
    return { ok: false, code: "modelo" };
  } finally {
    await conn.close();
  }
}
