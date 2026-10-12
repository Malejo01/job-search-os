import { schema as s, type Db } from "@job-search-os/db";
import { RECOMPUTE_FLOOR_MS, recomputeDecision, weekStartOf } from "@job-search-os/pipeline";
import { and, desc, eq, sql } from "drizzle-orm";
import { buildLearningPlan } from "./plan";
import { buildMarketSnapshot } from "./snapshot";

/**
 * Recálculo de mercado y plan bajo demanda para un usuario (ronda 28): buildMarketSnapshot +
 * buildLearningPlan, sin LLM, con el límite de `recomputeDecision` (D-029). La marca del límite es
 * una fila de job_queue (`queue = 'market_recompute'`, `status = 'done'`, payload vacío). Ningún
 * proceso la toma: el worker filtra por nombre de cola, `queueStatus` no la cuenta y la purga solo
 * borra las `done` viejas, que a esa altura ya no importan para la ventana. Corre como servicio y
 * filtra por user_id explícito, como el cron de mercado.
 */
export const MARKET_RECOMPUTE_QUEUE = "market_recompute";

export type RecomputeResult =
  | { ran: true; weekStart: string; jobs: number; skills: number; planItems: number }
  | { ran: false; reason: "ventana" | "piso" };

type Attempt =
  { run: true; markId: string } | { run: false; reason: "ventana" | "piso"; lastAt: Date | null };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Se separa "decidir + marcar" de "calcular". buildMarketSnapshot y buildLearningPlan abren sus
 * propias transacciones y leen con la conexión de `db`; meterlas en la del lock las haría anidar
 * (savepoints) y retendría el lock durante todo el cálculo. Con la marca insertada y confirmada
 * antes de calcular, un segundo guardado simultáneo ve la marca y no calcula. Si el cálculo
 * falla, se borra la marca para no bloquear el reintento durante la ventana.
 *
 * `inputsChanged` lo dice quien llama (guardó o quitó niveles, terminó la primera ingesta): el
 * adapter no adivina cambios leyendo fechas, así que no mezcla relojes ni se dispara por guardados
 * sin cambios.
 *
 * Si un pedido con cambios cae dentro de los 10 s de la última marca, espera lo que falta (como
 * mucho 10 s; `sleep` es inyectable para los tests) y decide de nuevo una sola vez; si vuelve a
 * dar "piso", devuelve "piso". Sin cambios no espera. Límites conocidos:
 * - un tercer pedido con cambios dentro de esa misma espera puede quedar en "piso" y no se
 *   recalcula hasta el próximo pedido (o el cron del lunes);
 * - si `after()` muere entre la marca y el cálculo, la marca bloquea la ventana de 10 minutos solo
 *   para pedidos sin cambios; uno con cambios corre igual pasado el mínimo de 10 s.
 */
export async function recomputeMarketForUser(
  db: Db,
  options: {
    userId: string;
    inputsChanged: boolean;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RecomputeResult> {
  const { userId } = options;
  const clock = () => options.now?.() ?? new Date();
  const sleep = options.sleep ?? realSleep;

  const attempt = (now: Date): Promise<Attempt> =>
    db.transaction(async (tx) => {
      // Un lock por usuario, hasta el commit: dos guardados simultáneos se serializan
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`market_recompute:${userId}`}, 0))`,
      );
      const [last] = await tx
        .select({ createdAt: s.jobQueue.createdAt })
        .from(s.jobQueue)
        .where(and(eq(s.jobQueue.queue, MARKET_RECOMPUTE_QUEUE), eq(s.jobQueue.userId, userId)))
        .orderBy(desc(s.jobQueue.createdAt))
        .limit(1);
      const lastAt = last?.createdAt ?? null;
      const d = recomputeDecision({
        now,
        lastRecomputeAt: lastAt,
        inputsChanged: options.inputsChanged,
      });
      if (!d.run) return { run: false, reason: d.reason, lastAt };
      const [mark] = await tx
        .insert(s.jobQueue)
        .values({
          queue: MARKET_RECOMPUTE_QUEUE,
          userId,
          payload: {},
          status: "done",
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: s.jobQueue.id });
      return { run: true, markId: mark!.id };
    });

  let now = clock();
  let decision = await attempt(now);
  if (!decision.run && decision.reason === "piso" && options.inputsChanged && decision.lastAt) {
    const missing = RECOMPUTE_FLOOR_MS - (now.getTime() - decision.lastAt.getTime());
    await sleep(Math.min(RECOMPUTE_FLOOR_MS, Math.max(0, missing)));
    now = clock();
    decision = await attempt(now);
  }
  if (!decision.run) return { ran: false, reason: decision.reason };

  try {
    const weekStart = weekStartOf(now);
    const snapshot = await buildMarketSnapshot(db, { userId, weekStart, now: () => now });
    const plan = await buildLearningPlan(db, { userId, weekStart });
    return {
      ran: true,
      weekStart,
      jobs: snapshot.jobs,
      skills: snapshot.skills,
      planItems: plan.rows.length,
    };
  } catch (e) {
    await db
      .delete(s.jobQueue)
      .where(eq(s.jobQueue.id, decision.markId))
      .catch(() => {});
    throw e;
  }
}
