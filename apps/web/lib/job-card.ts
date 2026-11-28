import { createDb, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import {
  createLogger,
  ensureJobCard,
  fillMissingJdHash,
  jobCardCapReason,
  safeDbError,
} from "@job-search-os/adapters";
import {
  JobCardSchema,
  hasEnoughJobText,
  jobCardAllowed,
  jobCardHash,
  jobCardMode,
  type JobCardView,
} from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import { withUser } from "@/lib/db";
import { serviceLlm } from "@/lib/llm-service";
import { getSessionEmail } from "@/lib/profile-agent/access";
import { testerEnvFor } from "@/lib/user-roles";

/**
 * La ficha del aviso para la pantalla de detalle (R31-03, ADR-048). `getJobCardFor(userId, jobId)` dice en qué
 * estado está y, si falta, la pide **una sola vez por texto** sin hacer esperar a la persona: se genera en
 * `after()` con la conexión de servicio (la ficha no es de nadie y la escribe el proceso que la genera).
 *
 * - `apagada`: `JOB_CARD` apagada o la persona no está en la etapa: la pantalla se ve como en la R30 y no se
 *   consulta ni se gasta nada.
 * - `sin_texto`: el aviso no tiene descripción suficiente; no se llama al modelo («Pegá la descripción…»).
 * - `lista`: la ficha ya verificada. La lectura va con RLS (la persona solo ve fichas de textos suyos o del pool).
 * - `preparando`: no hay ficha todavía; se pidió (o la está generando otro pedido). La pantalla se refresca sola.
 * - `fallida`: el modelo falló; se ofrece reintentar (`retryJobCardFor`).
 * - `tope`: tope diario de fichas o de gasto: la pantalla lo dice y el resto de la app sigue.
 *
 * Nunca lanza: ante cualquier error de lectura responde `fallida` (la página sigue). La lectura de la base de la
 * persona no deja rastro de quién pidió la ficha: la generación no recibe ni guarda el `userId`.
 */

/** ¿Esta persona ve la ficha? Sin el flag no se consulta la base; ante un error, no (falla cerrado). */
export async function jobCardAllowedFor(userId: string): Promise<boolean> {
  if (jobCardMode(process.env) === "off") return false;
  try {
    const email = await getSessionEmail(userId);
    return jobCardAllowed(await testerEnvFor(userId, email), email);
  } catch {
    return false;
  }
}

export async function getJobCardFor(userId: string, jobId: string): Promise<JobCardView> {
  if (!(await jobCardAllowedFor(userId))) return { status: "apagada" };
  const logger = createLogger({ user_id: userId, job_id: jobId, task: "job_card" });
  try {
    const [job] = await withUser(userId, (tx) =>
      tx
        .select({ jdText: s.jobs.jdText, jdHash: s.jobs.jdHash })
        .from(s.jobs)
        .where(eq(s.jobs.id, jobId))
        .limit(1),
    );
    if (!job || !hasEnoughJobText(job.jdText)) return { status: "sin_texto" };

    const hash = jobCardHash(job.jdText ?? "");
    // Oferta anterior a la columna: sin `jd_hash` la RLS no uniría la ficha con la oferta (quedaría «preparando»).
    // Se completa acá, con la sesión de la persona (RLS: solo su oferta).
    if (!job.jdHash) await withUser(userId, (tx) => fillMissingJdHash(tx, jobId, job.jdText));
    const [row] = await withUser(userId, (tx) =>
      tx
        .select({ status: s.jobCards.status, card: s.jobCards.card })
        .from(s.jobCards)
        .where(eq(s.jobCards.jdHash, hash))
        .limit(1),
    );
    if (row) {
      if (row.status === "lista") {
        const parsed = JobCardSchema.safeParse(row.card);
        return parsed.success ? { status: "lista", card: parsed.data } : { status: "fallida" };
      }
      return { status: row.status === "sin_texto" ? "sin_texto" : "fallida" };
    }

    // No hay ficha: primero el tope (así la pantalla lo dice en vez de «preparando» para siempre) y recién
    // después se pide, una vez por texto (la reserva con la etiqueta del hash evita pedidos dobles).
    if (await capReachedNow()) return { status: "tope" };
    scheduleJobCard(userId, jobId, { retry: false });
    return { status: "preparando" };
  } catch (e) {
    logger.error({ err: safeDbError(e) }, "ficha del aviso: no se pudo leer");
    return { status: "fallida" };
  }
}

/**
 * Reintento a pedido de una ficha `fallida` (botón «Reintentar»). Solo si la persona ve la ficha y el aviso es
 * suyo; el máximo de intentos y los topes los decide la reserva. Devuelve si se programó.
 */
export async function retryJobCardFor(userId: string, jobId: string): Promise<boolean> {
  if (!(await jobCardAllowedFor(userId))) return false;
  try {
    const [job] = await withUser(userId, (tx) =>
      tx.select({ id: s.jobs.id }).from(s.jobs).where(eq(s.jobs.id, jobId)).limit(1),
    );
    if (!job) return false;
    scheduleJobCard(userId, jobId, { retry: true });
    return true;
  } catch (e) {
    createLogger({ user_id: userId, job_id: jobId, task: "job_card" }).error(
      { err: safeDbError(e) },
      "ficha del aviso: no se pudo programar el reintento",
    );
    return false;
  }
}

async function capReachedNow(): Promise<boolean> {
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    return (await jobCardCapReason(db)) !== null;
  } finally {
    await close();
  }
}

/** Genera la ficha después de responder. Solo el texto entra a la generación: nada de la persona. */
function scheduleJobCard(userId: string, jobId: string, opts: { retry: boolean }): void {
  after(async () => {
    const logger = createLogger({ task: "job_card", trigger: "detalle" });
    const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
    try {
      // Filtro explícito por dueño: la conexión de servicio no pasa por RLS
      const [job] = await db
        .select({ jdText: s.jobs.jdText })
        .from(s.jobs)
        .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
        .limit(1);
      if (!job) return;
      const result = await ensureJobCard(
        { db, llm: serviceLlm(db, logger), logger },
        { text: job.jdText, retry: opts.retry },
      );
      logger.info({ status: result.status }, "ficha del aviso pedida desde el detalle");
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "ficha del aviso: falló la generación a pedido");
    } finally {
      await close();
    }
  });
}
