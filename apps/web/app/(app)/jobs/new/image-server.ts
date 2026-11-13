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
import { sql } from "drizzle-orm";
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
    // Una lectura a la vez por persona. Candado de transacción (`pg_try_advisory_xact_lock`) y no de
    // sesión: se libera solo al terminar la transacción, aun si algo falla o el proceso muere, y no
    // depende de que la conexión sea la misma (un pooler en modo transacción rompería el de sesión).
    // Todo corre dentro de esa transacción: el conteo, el tope de gasto y el registro de la llamada.
    const outcome = await conn.db.transaction((tx) =>
      extractJobFromImage(
        {
          llm: serviceLlm(tx, logger),
          // onlyOk (S2): un intento que falló antes de responder no gasta el cupo de 10 por día
          countSince: (since) =>
            countTaskCallsSince(tx, { userId, task: EXTRACT_IMAGE_TASK, since, onlyOk: true }),
          // Segundo tope sobre todos los intentos, también los fallidos (cost_usd null: el tope en USD no los ve)
          countAttemptsSince: (since) =>
            countTaskCallsSince(tx, { userId, task: EXTRACT_IMAGE_TASK, since }),
          capReason: () => spendCapReason(tx, { userId }),
          lock: {
            acquire: async () => {
              const rows = (await tx.execute(
                sql`select pg_try_advisory_xact_lock(hashtext(${`${EXTRACT_IMAGE_TASK}:${userId}`})) as ok`,
              )) as unknown as { ok: boolean }[];
              return rows[0]?.ok === true;
            },
            release: async () => {},
          },
        },
        { userId, image },
      ),
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
