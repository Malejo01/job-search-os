import { schema as s, type Db } from "@job-search-os/db";
import { resolvePlanLimit, type PoolLimits } from "@job-search-os/pipeline";
import { and, asc, eq } from "drizzle-orm";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { assignPoolToUser } from "./assign";
import { enqueueUnevaluated } from "./backlog";
import { countPoolAssigned, countPoolQueued } from "./usage";

/**
 * Asignación diaria del pool (ronda 38): para cada perfil con criterios activos reparte ofertas
 * nuevas hasta el tope diario. El tope es por ventana móvil de 24 h: lo ya asignado y lo ya
 * encolado en ese lapso se descuenta, así dos corridas seguidas no pasan del tope. Un error de un
 * usuario no corta a los demás. La cola de evaluación del día sale de todo lo asignado y sin
 * evaluar (`backlog.ts`), no solo de lo recién asignado; con tope de asignación agotado igual se
 * encola lo que corresponda. El resultado y los logs llevan solo conteos.
 */
export type PoolDailyResult = {
  /** Usuarios a los que se les asignó o encoló algo. */
  users: number;
  assigned: number;
  enqueued: number;
  discarded: number;
  errors: number;
  /** Se cortó por `budgetMs` antes de recorrer a todos. */
  stopped: boolean;
};

export type PoolDailyOptions = {
  logger: Logger;
  limits: PoolLimits;
  now?: () => Date;
  /** Tiempo máximo de la corrida en ms; al agotarse no se empieza con más usuarios. */
  budgetMs?: number;
  /** Reloj en ms para medir el presupuesto (inyectable en tests). */
  clock?: () => number;
  /** Entorno para `PRICING_ENABLED` (inyectable en tests); por defecto, `process.env`. */
  env?: Record<string, string | undefined>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export async function assignPoolDaily(db: Db, opts: PoolDailyOptions): Promise<PoolDailyResult> {
  const now = opts.now?.() ?? new Date();
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();
  const since = new Date(now.getTime() - DAY_MS);
  const result: PoolDailyResult = {
    users: 0,
    assigned: 0,
    enqueued: 0,
    discarded: 0,
    errors: 0,
    stopped: false,
  };

  const profiles = await db
    .selectDistinct({
      userId: s.profiles.userId,
      evalLimit: s.profiles.poolDailyEvalLimit,
      plan: s.profiles.plan,
      planUntil: s.profiles.planUntil,
    })
    .from(s.profiles)
    .innerJoin(
      s.evaluationCriteria,
      and(
        eq(s.evaluationCriteria.userId, s.profiles.userId),
        eq(s.evaluationCriteria.active, true),
      ),
    )
    .orderBy(asc(s.profiles.userId));

  for (const { userId, evalLimit, plan, planUntil } of profiles) {
    if (opts.budgetMs !== undefined && clock() - startedAt >= opts.budgetMs) {
      result.stopped = true;
      break;
    }
    try {
      // Tope propio > el del plan (solo con PRICING_ENABLED, C-11b) > el de la variable
      const evalCap = resolvePlanLimit(opts.env ?? process.env, "evaluationsPerDay", {
        override: evalLimit,
        plan,
        planUntil,
        now,
        fallback: opts.limits.dailyEvalPerUser,
      });
      const limit = Math.max(
        0,
        opts.limits.dailyAssignLimit - (await countPoolAssigned(db, userId, since)),
      );
      const enqueueTop = Math.max(0, evalCap - (await countPoolQueued(db, userId, since)));
      if (limit === 0 && enqueueTop === 0) continue;

      let assigned = 0;
      let discarded = 0;
      if (limit > 0) {
        // El descuento de 24 h se repite dentro del lock: dos corridas simultáneas no suman el doble
        const r = await assignPoolToUser(db, userId, {
          limit: opts.limits.dailyAssignLimit,
          enqueueTop: 0,
          deductLast24h: true,
          logger: opts.logger,
          now: () => now,
        });
        assigned = r.assigned;
        discarded = r.discarded;
      }
      // La cola del día sale de TODO lo asignado y sin evaluar, no solo de lo recién asignado
      const remaining = Math.max(0, evalCap - (await countPoolQueued(db, userId, since)));
      const q = await enqueueUnevaluated(db, userId, { count: remaining, logger: opts.logger });

      if (assigned + q.enqueued > 0) result.users++;
      result.assigned += assigned;
      result.enqueued += q.enqueued;
      result.discarded += discarded;
    } catch (e) {
      result.errors++;
      opts.logger.error({ user_id: userId, err: safeDbError(e) }, "pool: asignación diaria");
    }
  }

  opts.logger.info(
    {
      users: result.users,
      assigned: result.assigned,
      enqueued: result.enqueued,
      discarded: result.discarded,
      errors: result.errors,
      stopped: result.stopped,
    },
    "pool: asignación diaria terminada",
  );
  return result;
}
