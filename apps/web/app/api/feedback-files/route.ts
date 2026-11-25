import { createLogger } from "@job-search-os/adapters";
import {
  FEEDBACK_UPLOAD_MULTIPART_OVERHEAD_BYTES,
  FEEDBACK_UPLOAD_REQUEST_MAX_BYTES,
} from "@job-search-os/pipeline";
import {
  NO_STORE,
  errorResponse,
  parseUploadForm,
  requestOriginOk,
  storeFeedbackFile,
  uploadRateLimited,
} from "@/lib/feedback-files";
import { canViewRecorrido } from "@/lib/recorrido-access";
import { sessionUserId } from "@/lib/session";
import { needsTermsAcceptance } from "@/lib/terms-status";
import { readBytesLimited } from "@/lib/voice/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Subida de un adjunto del informe de revisión (R29-04). Route handler y no server action: una server action
 * tiene tope de 1 MB y no deja controlar el formato.
 *
 * Orden: sesión (401) → origen y términos → tester o admin (404 al resto) → límite de subidas (429) → cuerpo con
 * tope de 4 MB más el margen del multipart (413) → `itemId` y un solo archivo (400) → en una transacción: ítem
 * propio de un informe en borrador, cupos, validación por los bytes, archivo y fila. Nunca se devuelve la ref del
 * archivo ni el texto de una excepción; los logs llevan códigos, nunca el nombre ni el contenido.
 *
 * Contrato: `POST multipart/form-data` con `itemId` y `file`. 200 `{ ok: true, attachment }`; error
 * `{ ok: false, error, message }`.
 */
export async function POST(request: Request): Promise<Response> {
  const userId = await sessionUserId();
  if (!userId) return errorResponse("no_session");
  if (!requestOriginOk(request)) return errorResponse("forbidden");
  const logger = createLogger({ user_id: userId, trigger: "feedback_files" });
  try {
    if (await needsTermsAcceptance(userId)) return errorResponse("forbidden");
    // Solo testers y admins ven lo nuevo del informe: para el resto, como si la ruta no existiera
    if (!(await canViewRecorrido(userId))) return errorResponse("forbidden");

    if (await uploadRateLimited(userId)) {
      logger.warn({ outcome: "rate_limited" }, "adjunto: demasiadas subidas");
      return errorResponse("rate_limited");
    }

    const contentType = request.headers.get("content-type") ?? "";
    const body = await readBytesLimited(
      request,
      FEEDBACK_UPLOAD_REQUEST_MAX_BYTES + FEEDBACK_UPLOAD_MULTIPART_OVERHEAD_BYTES,
    );
    if (!body.ok) return errorResponse("request_too_large");

    const form = await parseUploadForm(body.bytes, contentType);
    if (!form.ok) return errorResponse(form.error);

    const out = await storeFeedbackFile(userId, {
      itemId: form.itemId,
      name: form.name,
      bytes: form.bytes,
    });
    if (!out.ok) {
      logger.warn({ outcome: out.error, bytes: form.bytes.length }, "adjunto: rechazado");
      return errorResponse(out.error);
    }
    logger.info({ kind: out.attachment.kind, bytes: out.attachment.bytes }, "adjunto: guardado");
    return Response.json({ ok: true, attachment: out.attachment }, { headers: NO_STORE });
  } catch {
    // Nunca el mensaje de la excepción: puede citar datos de la persona
    logger.error({}, "adjunto: falló la subida");
    return errorResponse("server_error");
  }
}
