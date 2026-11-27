import {
  checkBearerSecret,
  createDbNewsStore,
  createLogger,
  runNewsEmail,
  safeDbError,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { isRoleKey } from "@job-search-os/pipeline";
import { NextResponse } from "next/server";
import { catalogLabel } from "@/lib/career-names";
import { SELLOS_TEXTOS } from "@/lib/textos-rediseno";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Email de novedades (R32-09): lo dispara un cron semanal (el paso de `.github/workflows/cron.yml` lo agrega el
 * responsable). Un email, como mucho semanal, con las ofertas nuevas de la carrera de cada persona y solo si las hay.
 * Detrás de `NEWS_EMAIL` (apagada por defecto: no lee la base ni manda nada), con tope diario
 * (`NEWS_EMAIL_DAILY_CAP`) y sin hacer nada si faltan `RESEND_API_KEY`, `EMAIL_FROM` o la clave de la baja.
 * Protegido por CRON_SECRET. La respuesta va al log público de Actions: solo conteos, nunca emails ni ids.
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

  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  const logger = createLogger({ cron: "news-email" });
  try {
    const result = await runNewsEmail({
      store: createDbNewsStore(db),
      env: process.env,
      now: new Date(),
      logger,
      labels: {
        // Solo carreras del catálogo: lo que no se conoce no se nombra
        careerLabel: (role) => (isRoleKey(role) ? catalogLabel(role) : null),
        // Sellos y textos de la R30
        sealWords: {
          alta: SELLOS_TEXTOS.alta,
          media: SELLOS_TEXTOS.media,
          baja: SELLOS_TEXTOS.baja,
          sin_evaluar: SELLOS_TEXTOS.sin_evaluar,
        },
        aclaracion: SELLOS_TEXTOS.aclaracion,
      },
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error({ err: safeDbError(error) }, "cron news-email falló");
    return NextResponse.json({ ok: false, error: "news-email falló" }, { status: 500 });
  } finally {
    await close();
  }
}
