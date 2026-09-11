import { createDb, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import { buildLearningPlan, buildMarketSnapshot, createLogger } from "@job-search-os/adapters";
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
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
  const logger = createLogger({ cron: "market" });
  try {
    const users = await db.select({ id: s.users.id }).from(s.users);
    const results = [];
    for (const u of users) {
      const snapshot = await buildMarketSnapshot(db, { userId: u.id });
      const plan = await buildLearningPlan(db, { userId: u.id, weekStart: snapshot.weekStart });
      logger.info(
        { user_id: u.id, week: snapshot.weekStart, jobs: snapshot.jobs, plan: plan.rows.length },
        "snapshot y plan",
      );
      results.push({
        userId: u.id,
        weekStart: snapshot.weekStart,
        jobs: snapshot.jobs,
        skills: snapshot.skills,
        planItems: plan.rows.length,
        planInserted: plan.inserted,
        planRemoved: plan.removed,
      });
    }
    return NextResponse.json({ ok: true, users: results.length, results });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "cron market falló",
    );
    return NextResponse.json({ ok: false, error: "snapshot falló" }, { status: 500 });
  } finally {
    await close();
  }
}
