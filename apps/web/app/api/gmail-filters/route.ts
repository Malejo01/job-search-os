import {
  DEFAULT_ALERT_SENDERS,
  gmailFiltersXml,
  isLegacyInboundAddress,
} from "@job-search-os/pipeline";
import { auth } from "@/auth";
import { getInboundAddress } from "@/lib/inbound-address";

export const dynamic = "force-dynamic";

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Archivo de filtros de Gmail con la dirección del usuario de la sesión (nunca la de otro).
 * La dirección es un secreto: no se loguea. Sin sesión, 401 (sin redirigir: lo consume un link de descarga).
 */
export async function GET(): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json(401, "Iniciá sesión para descargar los filtros.");
  const address = await getInboundAddress(userId);
  if (!address || isLegacyInboundAddress(address, userId)) {
    return json(409, "Todavía no tenés una dirección de reenvío vigente. Generá una en Ajustes.");
  }
  let xml: string;
  try {
    xml = gmailFiltersXml({
      forwardTo: address,
      senders: DEFAULT_ALERT_SENDERS,
      now: new Date(),
    });
  } catch {
    return json(409, "Todavía no tenés una dirección de reenvío vigente. Generá una en Ajustes.");
  }
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'attachment; filename="filtros-job-search-os.xml"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
