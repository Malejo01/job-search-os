import { checkBearerSecret, createLogger, safeDbError } from "@job-search-os/adapters";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { assertAppRole, getAppDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Respuesta pública: la absorbe el CDN, así un monitor o un curioso no despierta la base en cada pedido. */
const PUBLIC_CACHE = { "Cache-Control": "public, s-maxage=15" };

/**
 * GET /api/health (JS-019). Dos formas:
 * - Pública (sin bearer, o con uno que no es el del cron): `{ ok, commit }` con caché corta y **sin tocar la
 *   base**. Dice que la app responde, no que la base esté bien.
 * - Con `Authorization: Bearer <CRON_SECRET>`: además verifica que la base responde con el rol de la app y
 *   que ese rol no puede saltear RLS. Sin caché. 503 con el motivo en el log, no en la respuesta.
 */
export async function GET(request: Request): Promise<NextResponse> {
  // Se lee al responder, no a nivel de módulo: así refleja el deploy que atiende.
  const commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const authorized = checkBearerSecret({
    authorization: request.headers.get("authorization"),
    expected: process.env.CRON_SECRET,
  });
  if (!authorized) return NextResponse.json({ ok: true, commit }, { headers: PUBLIC_CACHE });

  const startedAt = Date.now();
  try {
    await assertAppRole();
    await getAppDb().execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, db: "ok", latency_ms: Date.now() - startedAt, commit },
      { headers: NO_STORE },
    );
  } catch (error) {
    // El detalle (host, rol, código de Postgres) va al log, nunca a la respuesta (SEC-04).
    createLogger({ route: "health" }).error({ err: safeDbError(error) }, "health falló");
    return NextResponse.json({ ok: false, error: "unhealthy" }, { status: 503, headers: NO_STORE });
  }
}
