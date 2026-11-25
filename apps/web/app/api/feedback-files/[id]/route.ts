import { createLogger } from "@job-search-os/adapters";
import {
  NO_STORE,
  deleteFeedbackFile,
  downloadHeaders,
  errorResponse,
  isUuid,
  loadFeedbackFile,
  requestOriginOk,
} from "@/lib/feedback-files";
import { sessionUserId } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Descarga de un adjunto (R29-04): solo la dueña o un admin (este último, solo de informes ya enviados). Con
 * sesión siempre; nunca una URL pública ni la ref del archivo. El tipo sale de la base, no del cliente.
 * `nosniff`, CSP `sandbox` y sin caché; PDF y DOCX como `attachment`, solo el WebP reescrito va `inline`.
 * «No existe» y «no es tuyo» responden igual (404).
 */
export async function GET(_request: Request, { params }: Ctx): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return errorResponse("no_session");
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("not_found");
  try {
    const file = await loadFeedbackFile(userId, id.toLowerCase());
    if (!file) return errorResponse("not_found");
    return new Response(file.bytes as BodyInit, {
      headers: downloadHeaders({
        kind: file.kind,
        mime: file.mime,
        name: file.name,
        size: file.bytes.byteLength,
      }),
    });
  } catch {
    createLogger({ user_id: userId, trigger: "feedback_files" }).error(
      {},
      "adjunto: falló la descarga",
    );
    return errorResponse("server_error");
  }
}

/** Borra un adjunto propio mientras el informe es borrador (con su archivo). Después de enviado no se toca. */
export async function DELETE(request: Request, { params }: Ctx): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return errorResponse("no_session");
  if (!requestOriginOk(request)) return errorResponse("forbidden");
  const { id } = await params;
  if (!isUuid(id)) return errorResponse("not_found");
  try {
    const out = await deleteFeedbackFile(userId, id.toLowerCase());
    if (!out.ok) return errorResponse(out.error);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch {
    createLogger({ user_id: userId, trigger: "feedback_files" }).error(
      {},
      "adjunto: falló el borrado",
    );
    return errorResponse("server_error");
  }
}
