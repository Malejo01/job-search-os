import {
  FEEDBACK_UPLOAD_REQUEST_MAX_BYTES,
  IMAGE_MAX_BYTES,
  type AttachmentErrorCode,
} from "@job-search-os/pipeline";

/**
 * Qué se hace con cada archivo antes de subirlo (R29-03). Puro y sin DOM: lo usa el editor del informe
 * (cliente) y los tests. El servidor vuelve a comprobar todo por los bytes (`attachment.ts`): esto solo evita
 * subir lo que se sabe que no va a pasar y arma las imágenes como las espera el servidor (siempre WebP).
 */

/** Lado mayor de una imagen ya comprimida. */
export const IMAGE_MAX_SIDE = 2000;

/** Escala `width x height` para que el lado mayor no pase de `maxSide`, sin agrandar y sin llegar a 0. */
export function fitWithin(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return { width: 1, height: 1 };
  }
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/**
 * Intentos de compresión a WebP, en orden: primero baja la calidad a tamaño completo y recién después achica la
 * imagen (la calidad se nota menos que la nitidez de un texto en una captura). Se corta en el primero que da
 * menos de `IMAGE_STORED_MAX_BYTES`.
 */
export const COMPRESSION_PLAN: readonly { quality: number; scale: number }[] = [
  1, 0.75, 0.5,
].flatMap((scale) => [0.9, 0.8, 0.7, 0.6, 0.5, 0.4].map((quality) => ({ quality, scale })));

export type UploadPlan =
  { action: "image" } | { action: "upload" } | { action: "reject"; reason: AttachmentErrorCode };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const DOCUMENT_EXTENSIONS = /\.(pdf|docx)$/i;

/**
 * El camino de un archivo: `image` (se comprime a WebP en el navegador), `upload` (documento, sube tal cual) o
 * `reject` con el código de error (el texto sale de `ATTACHMENT_ERROR_TEXTS`). Manda el tipo que declara el
 * navegador; si no dice nada (Windows con algunos .docx), la extensión. Un documento de más de 4 MB se rechaza
 * acá (límite de la función de Vercel).
 */
export function planFileUpload(file: { name: string; type: string; size: number }): UploadPlan {
  if (file.size <= 0) return { action: "reject", reason: "empty" };
  const type = file.type.toLowerCase();
  const isImage = IMAGE_TYPES.has(type) || (type === "" && IMAGE_EXTENSIONS.test(file.name));
  if (isImage) {
    return file.size > IMAGE_MAX_BYTES
      ? { action: "reject", reason: "too_large" }
      : { action: "image" };
  }
  const isDocument =
    type === PDF_TYPE || type === DOCX_TYPE || (type === "" && DOCUMENT_EXTENSIONS.test(file.name));
  if (!isDocument) return { action: "reject", reason: "type" };
  return file.size > FEEDBACK_UPLOAD_REQUEST_MAX_BYTES
    ? { action: "reject", reason: "request_too_large" }
    : { action: "upload" };
}

/**
 * Los ítems que hay que guardar, en orden: los que cambiaron respecto de lo último guardado (`saved`, por id). Cada
 * uno viaja en su propio pedido (tope de 1 MB por server action); un ítem que falla queda en esta lista y se
 * reintenta en el próximo ciclo.
 */
export function itemsToSave<T extends { id: string }>(
  items: readonly T[],
  saved: Readonly<Record<string, string>>,
  signature: (item: T) => string,
): T[] {
  return items.filter((i) => saved[i.id] !== signature(i));
}
