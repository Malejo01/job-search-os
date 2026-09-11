import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertAppRole, getAppDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health (JS-019): sin auth, sin datos. Verifica que la base responde con el rol de la
 * app y que ese rol no puede saltear RLS. 503 con el motivo si algo falla.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    await assertAppRole();
    await getAppDb().execute(sql`select 1`);
    return NextResponse.json({
      ok: true,
      db: "ok",
      latency_ms: Date.now() - startedAt,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 503 },
    );
  }
}
