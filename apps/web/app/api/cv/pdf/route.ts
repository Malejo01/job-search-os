import { createLogger } from "@job-search-os/adapters";
import { buildCvPdf, cvFileName } from "@job-search-os/pipeline";
import { cvDownloadAllowed } from "@/lib/cv-download-rate";
import { buildUserCv, cvOptionsFromSearchParams } from "@/lib/cv-source";
import { sessionUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function json(status: number, error: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error }, { status, headers: { ...NO_STORE, ...extra } });
}

/**
 * Descarga del CV en PDF (R33-08, ADR-049). Mismo contrato que `/api/cv/docx`: el usuario sale de la sesión
 * vigente (nunca de un parámetro); sin sesión, 401 sin redirigir. Orden: sesión (401) → ritmo (429 con
 * `Retry-After`) → datos de la persona con `withUser` (RLS) → PDF en memoria. No se guarda ningún archivo ni
 * hay URL pública: la respuesta es `attachment` con `no-store`. No se loguea el contenido ni el nombre; solo
 * páginas, cantidad de reemplazos de caracteres y el usuario.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return json(401, "Iniciá sesión para descargar tu CV.");
  const logger = createLogger({ user_id: userId, trigger: "cv_pdf" });

  const rate = cvDownloadAllowed(userId);
  if (!rate.allowed) {
    logger.warn({ outcome: "rate_limited" }, "cv pdf: demasiadas descargas");
    return json(429, "Descargaste muchas veces seguidas. Probá de nuevo en un rato.", {
      "Retry-After": String(rate.retryAfterSeconds),
    });
  }

  const opts = cvOptionsFromSearchParams(new URL(request.url).searchParams);
  try {
    const doc = await buildUserCv(userId, opts);
    if (!doc) return json(404, "Completá tu perfil para armar el CV.");
    const pdf = buildCvPdf(doc);
    logger.info(
      { pages: pdf.pages, substitutions: pdf.substitutions.reduce((n, s) => n + s.count, 0) },
      "cv pdf: generado",
    );
    return new Response(pdf.bytes.slice().buffer as ArrayBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${cvFileName(doc, "pdf")}"`,
        "Content-Length": String(pdf.bytes.byteLength),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "cv pdf: falló la generación");
    return json(500, "No pudimos armar tu CV. Probá de nuevo en un rato.");
  }
}
