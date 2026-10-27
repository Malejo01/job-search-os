import { buildCvDocx, cvFileName } from "@job-search-os/pipeline";
import { buildUserCv, parseCvOptions } from "@/lib/cv-source";
import { sessionUserId } from "@/lib/session";

export const dynamic = "force-dynamic";

function json(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Descarga del CV en DOCX (C-25, CVC-2). El usuario sale de la sesión vigente (nunca de un parámetro):
 * sin sesión, 401 sin redirigir, porque lo consume un link de descarga. Se genera en memoria y no se
 * guarda. Solo datos de la persona, leídos con `withUser` (RLS). No se loguea el contenido.
 */
export async function GET(request: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return json(401, "Iniciá sesión para descargar tu CV.");
  const params = new URL(request.url).searchParams;
  const opts = parseCvOptions({
    lang: params.get("lang") ?? undefined,
    email: params.get("email") ?? undefined,
    basicas: params.get("basicas") ?? undefined,
  });
  let doc;
  try {
    doc = await buildUserCv(userId, opts);
  } catch {
    return json(500, "No pudimos armar tu CV. Probá de nuevo en un rato.");
  }
  if (!doc) return json(404, "Completá tu perfil para armar el CV.");
  const bytes = buildCvDocx(doc);
  return new Response(bytes.slice().buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${cvFileName(doc, "docx")}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
