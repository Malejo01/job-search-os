/**
 * Subir el CV (ADR-034 §9, R10-1): lo que se decide en el navegador antes de mandar nada y los mensajes
 * fijos de cada falla. Puro: sin archivos, sin red. El archivo no sale del navegador; al servidor llega
 * solo el texto, que el servidor vuelve a normalizar y redactar (el cliente no se cree).
 *
 * Los mensajes son fijos y nunca citan el CV, el nombre del archivo ni la salida del modelo.
 */
import { CV_MAX_FILE_BYTES, CV_MAX_TEXT_CHARS, CV_MIN_TEXT_CHARS } from "../../cv/limits";
import { normalizeCvText } from "../../cv/normalize-text";
import { err, ok, type Result } from "../../result";
import type { ProfileAgentBase } from "../routes";
import { z } from "zod";

/** Largo máximo del cuerpo del pedido (en caracteres): el texto crudo, antes de normalizarlo. */
export const PROFILE_READ_MAX_BODY_CHARS = 120_000;
/** Largo máximo del campo `text` antes de normalizar (el normalizado se acota con `CV_MAX_TEXT_CHARS`). */
export const PROFILE_READ_MAX_RAW_TEXT_CHARS = 100_000;

/** Cuerpo del pedido a `/api/cv-perfil/leer`. Estricto: no hay dónde llevar el archivo ni un ticket. */
export const profileReadRequestSchema = z.strictObject({
  text: z.string().max(PROFILE_READ_MAX_RAW_TEXT_CHARS),
});
export type ProfileReadRequest = z.infer<typeof profileReadRequestSchema>;

// ---------------------------------------------------------------------------
// Archivo elegido o arrastrado
// ---------------------------------------------------------------------------

export type CvUploadKind = "pdf" | "docx";
export type CvUploadError = "empty" | "too_large" | "legacy_doc" | "unsupported";

/**
 * Primer chequeo por nombre y tamaño, sin leer el archivo. No reemplaza al tipo por contenido
 * (`sniffCvFile`), que el navegador corre después sobre los bytes: acá solo se evita leer en memoria un
 * archivo de 200 MB o una imagen.
 */
export function classifyCvUpload(file: {
  name: string;
  size: number;
}): Result<CvUploadKind, CvUploadError> {
  if (!(file.size > 0)) return err("empty");
  if (file.size > CV_MAX_FILE_BYTES) return err("too_large");
  const name = file.name.trim().toLowerCase();
  if (name.endsWith(".pdf")) return ok("pdf");
  if (name.endsWith(".docx")) return ok("docx");
  if (name.endsWith(".doc")) return err("legacy_doc");
  return err("unsupported");
}

/** Texto de un archivo o pegado, ya normalizado, o por qué no sirve. */
export type CvTextSource = "file" | "paste";

export type ProfileReadInputProblem =
  | CvUploadError
  | "pdf_paste"
  | "macro_enabled"
  | "not_docx"
  | "unreadable"
  | "text_too_short"
  | "text_too_long";

/**
 * Texto que sale del navegador: se normaliza igual que en el servidor. Si el texto de un archivo es
 * demasiado corto (PDF escaneado, imagen, DOCX vacío) el problema es `unreadable`, que ofrece seguir con la
 * charla desde cero; si fue pegado, `text_too_short`.
 */
export function checkProfileReadText(
  text: string,
  source: CvTextSource,
): Result<string, ProfileReadInputProblem> {
  const normalized = normalizeCvText(text);
  if (normalized.ok) return ok(normalized.value);
  if (normalized.error === "too_long") return err("text_too_long");
  return err(source === "file" ? "unreadable" : "text_too_short");
}

// ---------------------------------------------------------------------------
// Mensajes (fijos) y caminos alternativos
// ---------------------------------------------------------------------------

export const PROFILE_READ_INPUT_MESSAGES: Record<ProfileReadInputProblem, string> = {
  empty: "El archivo está vacío. Elegí otro o pegá el texto de tu CV.",
  too_large: `El archivo pesa más de ${Math.round(CV_MAX_FILE_BYTES / (1024 * 1024))} MB. Elegí uno más liviano o pegá el texto de tu CV.`,
  legacy_doc:
    "Los archivos .doc viejos no se pueden leer. Guardalo como DOCX o PDF, o pegá el texto de tu CV.",
  unsupported: "Solo se pueden leer PDF y DOCX. Elegí otro archivo o pegá el texto de tu CV.",
  // El PDF se lee con una librería que todavía no está en la app (ADR-034 §11)
  pdf_paste:
    "Pegá el texto de tu CV. Por ahora los PDF no se leen en el navegador: abrilo, copiá el texto y pegalo acá. Tu archivo no se sube.",
  macro_enabled:
    "Ese archivo trae macros y no lo leemos. Guardalo como DOCX común o pegá el texto de tu CV.",
  not_docx: "No pudimos abrir ese archivo como un DOCX. Probá con otro o pegá el texto de tu CV.",
  unreadable:
    "No pudimos leer texto en ese archivo. Si es un PDF escaneado o una imagen, no se puede leer. Pegá el texto de tu CV o seguí con la charla desde cero.",
  text_too_short: `El texto es muy corto para leerlo (mínimo ${CV_MIN_TEXT_CHARS} caracteres). Pegá el CV completo o seguí con la charla desde cero.`,
  text_too_long: `El texto es muy largo (máximo ${CV_MAX_TEXT_CHARS.toLocaleString("es-AR")} caracteres). Dejá solo tu experiencia, estudios, skills e idiomas.`,
};

/** Problemas de entrada en los que ofrecemos «seguir con la charla desde cero». */
const OFFERS_FALLBACK: ReadonlySet<ProfileReadInputProblem> = new Set([
  "unreadable",
  "text_too_short",
  "not_docx",
  "macro_enabled",
]);

export type ProfileReadFallback = { label: string; href: string };

/**
 * Caminos alternativos. En `/cv` (la persona ya tiene el onboarding completo) hay charla desde cero y
 * carga manual del historial; durante el onboarding, `(app)` no se alcanza: solo volver al formulario.
 */
export function profileReadFallbacks(base: ProfileAgentBase): ProfileReadFallback[] {
  return base === "app"
    ? [
        { label: "Seguir con la charla desde cero", href: "/cv/armar" },
        { label: "Completarlo a mano", href: "/settings/historial" },
      ]
    : [{ label: "Prefiero completarlo a mano", href: "/onboarding" }];
}

export type ProfileReadInputNotice = { message: string; fallbacks: ProfileReadFallback[] };

/** Aviso para la persona: mensaje fijo y, si corresponde, los caminos alternativos. */
export function profileReadInputNotice(
  problem: ProfileReadInputProblem,
  base: ProfileAgentBase,
): ProfileReadInputNotice {
  return {
    message: PROFILE_READ_INPUT_MESSAGES[problem],
    fallbacks: OFFERS_FALLBACK.has(problem) ? profileReadFallbacks(base) : [],
  };
}

// ---------------------------------------------------------------------------
// Errores del endpoint
// ---------------------------------------------------------------------------

/**
 * Orden de los chequeos del endpoint (O7): origen, sesión (401), flag (404), tope. La lectura es la
 * puerta de entrada de una charla: no trae ticket, lo emite.
 */
export type ProfileReadErrorCode =
  | "bad_origin"
  | "bad_request"
  | "unauthorized"
  | "not_ready"
  | "not_found"
  | "too_long"
  | "text_too_short"
  | "text_too_long"
  | "injection"
  | "in_progress"
  | "capped"
  | "llm_unavailable"
  | "unreadable_result"
  | "server";

export const PROFILE_READ_ERRORS: Record<
  Exclude<ProfileReadErrorCode, "capped">,
  { status: number; message: string }
> = {
  bad_origin: { status: 403, message: "Pedido no permitido." },
  bad_request: {
    status: 400,
    message: "No entendimos el pedido. Recargá la página e intentá de nuevo.",
  },
  unauthorized: { status: 401, message: "Iniciá sesión para subir tu CV." },
  not_ready: { status: 403, message: "Antes aceptá los términos." },
  not_found: { status: 404, message: "No encontramos esta página." },
  too_long: { status: 413, message: PROFILE_READ_INPUT_MESSAGES.text_too_long },
  text_too_short: { status: 422, message: PROFILE_READ_INPUT_MESSAGES.text_too_short },
  text_too_long: { status: 422, message: PROFILE_READ_INPUT_MESSAGES.text_too_long },
  injection: {
    status: 422,
    message:
      "No pudimos leer ese texto. Dejá solo tu experiencia, estudios, skills e idiomas, o completá tu perfil a mano.",
  },
  in_progress: {
    status: 409,
    message: "Ya estamos leyendo tu CV. Esperá a que termine.",
  },
  llm_unavailable: {
    status: 503,
    message:
      "Ahora no pudimos leer tu CV. No se descontó de tu cupo. Probá de nuevo en un rato o completá tu perfil a mano.",
  },
  unreadable_result: {
    status: 422,
    message:
      "No pudimos armar una propuesta confiable con ese texto. No se descontó de tu cupo. Pegá el texto de nuevo o completá tu perfil a mano.",
  },
  server: { status: 500, message: "No pudimos completar el pedido. Probá de nuevo en un rato." },
};

/** Códigos que devuelve `readCvForAgent` (adapters) → código del endpoint. Todo lo no listado es `server`. */
export function profileReadErrorFor(code: string): Exclude<ProfileReadErrorCode, "capped"> {
  switch (code) {
    case "disabled":
      return "not_found";
    case "text_too_short":
      return "text_too_short";
    case "text_too_long":
      return "text_too_long";
    case "injection_detected":
      return "injection";
    case "in_progress":
      return "in_progress";
    case "timeout":
    case "aborted":
    case "llm_failed":
    case "no_route":
      return "llm_unavailable";
    case "output_invalid":
    case "sensitive_output":
    case "redaction_failed":
      return "unreadable_result";
    default:
      return "server";
  }
}
