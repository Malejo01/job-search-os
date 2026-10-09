import { createLogger, safeDbError } from "@job-search-os/adapters";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertAppRole, getAppDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/health (JS-019): sin auth, sin datos. Verifica que la base responde con el rol de la
 * app y que ese rol no puede saltear RLS. 503 con el motivo si algo falla.
 */
export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  try {
    await assertAppRole();
    await getAppDb().execute(sql`select 1`);
    return NextResponse.json(
      {
        ok: true,
        db: "ok",
        latency_ms: Date.now() - startedAt,
        // Se lee al responder, no a nivel de módulo: así refleja el deploy que atiende.
        commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // El detalle (host, rol, código de Postgres) va al log, nunca a la respuesta (SEC-04).
    createLogger({ route: "health" }).error({ err: safeDbError(error) }, "health falló");
    return NextResponse.json({ ok: false, error: "unhealthy" }, { status: 503, headers: NO_STORE });
  }
}
