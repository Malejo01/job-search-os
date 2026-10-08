import { createDb, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import {
  buildLearningPlan,
  buildMarketSnapshot,
  checkBearerSecret,
  createLogger,
  safeDbError,
} from "@job-search-os/adapters";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Snapshot semanal de mercado + plan de formación (JS-031/JS-034, sin LLM): lo dispara
 * .github/workflows/cron.yml los lunes (docs/DEPLOY.md). Para cada usuario recalcula
 * market_snapshots de la semana actual y sincroniza learning_plan_items. Protegido por CRON_SECRET.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (
    !checkBearerSecret({
      authorization: request.headers.get("authorization"),
      expected: process.env.CRON_SECRET,
    })
  ) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "market" });
  try {
    // Desde profiles, como la ingesta (run-sources.ts): no depende de leer `users` (JS-103)
    const users = await db.select({ id: s.profiles.userId }).from(s.profiles);
    // La respuesta va al log público de Actions (cron.yml): solo agregados, sin ids ni skills.
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
    return NextResponse.json({ ok: true, users: users.length, ...totals });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron market falló");
    return NextResponse.json({ ok: false, error: "snapshot falló" }, { status: 500 });
  } finally {
    await close();
  }
}
