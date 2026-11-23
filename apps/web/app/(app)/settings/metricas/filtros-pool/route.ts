import { BETA_LAUNCH_ROLE_KEYS, poolGmailFilterXml } from "@job-search-os/pipeline";
import { NextResponse } from "next/server";
import { adminRouteDenied } from "@/lib/admin-guard";
import { activeSessionUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /settings/metricas/filtros-pool?carrera=<clave>: el filtro de Gmail de una carrera para las casillas del
 * pool (`from:computrabajo.com` → `pool-<carrera>@<INGEST_DOMAIN>`), como XML para «Importar filtros». Solo
 * admin (404 para una cuenta común). Falla cerrado: sin `INGEST_DOMAIN` válido o con una carrera desconocida
 * no devuelve ningún XML. No contiene datos de personas ni se loguea nada.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await activeSessionUserId();
  if (!userId) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const denied = await adminRouteDenied(userId);
  if (denied) return denied;
  const career = new URL(request.url).searchParams.get("carrera") ?? "";
  let xml: string;
  try {
    xml = poolGmailFilterXml({
      ingestDomain: process.env.INGEST_DOMAIN ?? "",
      career,
      careers: BETA_LAUNCH_ROLE_KEYS,
      now: new Date(),
    });
  } catch {
    return NextResponse.json(
      { error: "Falta INGEST_DOMAIN o la carrera no es válida." },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="filtro-pool-${career}.xml"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
