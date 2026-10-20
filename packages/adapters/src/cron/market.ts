import { schema as s, type Db } from "@job-search-os/db";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { buildLearningPlan } from "../market/plan";
import { buildRoleMarketSnapshots } from "../market/role-snapshot";
import { buildMarketSnapshot } from "../market/snapshot";
import type { CronRunResult } from "./ingest";

/**
 * Snapshot semanal de mercado + plan de formación (JS-031/JS-034, sin LLM): lo corre el runner de
 * Actions con `pnpm cron:run market` los lunes; la ruta /api/cron/market es el respaldo.
 * Para cada usuario recalcula market_snapshots de la semana actual y sincroniza learning_plan_items.
 */
export async function runMarketCron(opts: { db: Db; logger: Logger }): Promise<CronRunResult> {
  const { db, logger } = opts;
  try {
    // Mercado por rol (pool): primero, y en su propio try; si falla, el de cada usuario sigue
    let roles: number | null = null;
    try {
      roles = (await buildRoleMarketSnapshots(db)).roles;
    } catch (error) {
      logger.error({ err: safeDbError(error) }, "cron mercado por rol falló");
    }
    // Desde profiles, como la ingesta (run-sources.ts): no depende de leer `users` (JS-103)
    const users = await db.select({ id: s.profiles.userId }).from(s.profiles);
    // El body va al log público de Actions: solo agregados, sin ids ni skills.
    // El detalle por usuario queda en el log del servidor.
    const totals = { jobs: 0, planItems: 0, planInserted: 0, planRemoved: 0 };
    for (const u of users) {
      const snapshot = await buildMarketSnapshot(db, { userId: u.id });
      const plan = await buildLearningPlan(db, { userId: u.id, weekStart: snapshot.weekStart });
      logger.info(
        {
          user_id: u.id,
          week: snapshot.weekStart,
          jobs: snapshot.jobs,
          skills: snapshot.skills,
          plan: plan.rows.length,
        },
        "snapshot y plan",
      );
      totals.jobs += snapshot.jobs;
      totals.planItems += plan.rows.length;
      totals.planInserted += plan.inserted;
      totals.planRemoved += plan.removed;
    }
    return {
      ok: true,
      body: {
        ok: true,
        users: users.length,
        ...(roles !== null ? { roles } : {}),
        ...totals,
      },
    };
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron market falló");
    return { ok: false, body: { ok: false, error: "snapshot falló" } };
  }
}
