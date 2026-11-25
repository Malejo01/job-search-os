import {
  ATTACHMENT_ERROR_TEXTS,
  ATTACHMENT_KINDS,
  IMAGE_STORED_MAX_BYTES,
  type AttachmentErrorCode,
  type AttachmentKind,
} from "@job-search-os/pipeline";
import { COMPRESSION_PLAN, IMAGE_MAX_SIDE, fitWithin } from "./feedback-report-files";

/**
 * Lo que el informe de revisión hace en el navegador (R29-03): achicar imágenes a WebP, sacar una captura de la
 * pantalla y hablar con `/api/feedback-files`. Solo cliente (usa canvas, `fetch` y `mediaDevices`); no se importa
 * desde el servidor. Sin dependencias: canvas, `createImageBitmap` y `getDisplayMedia` son del navegador.
 */

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

export type CompressResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; reason: "unsupported" | "decode" | "too_big" };

/**
 * PNG, JPEG o WebP a WebP con el lado mayor en 2.000 px, bajando la calidad (y después el tamaño) hasta que pese
 * menos de 1,5 MB. El servidor solo acepta WebP: si el navegador no sabe codificarlo (`toBlob` devuelve otro
 * formato), se avisa en vez de mandar algo que se va a rechazar.
 */
export async function compressImageToWebp(file: Blob): Promise<CompressResult> {
  if (typeof createImageBitmap !== "function") return { ok: false, reason: "unsupported" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { ok: false, reason: "decode" };
  }
  try {
    const base = fitWithin(bitmap.width, bitmap.height, IMAGE_MAX_SIDE);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "unsupported" };
    for (const { quality, scale } of COMPRESSION_PLAN) {
      const width = Math.max(1, Math.round(base.width * scale));
      const height = Math.max(1, Math.round(base.height * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!blob) return { ok: false, reason: "unsupported" };
      if (blob.type !== "image/webp") return { ok: false, reason: "unsupported" };
      if (blob.size < IMAGE_STORED_MAX_BYTES) return { ok: true, blob, width, height };
    }
    return { ok: false, reason: "too_big" };
  } finally {
    bitmap.close();
  }
}

/** ¿Este navegador puede sacar una captura de pantalla? (computadora: sí; celular: casi nunca). */
export function canCaptureScreen(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}

/**
 * Pide elegir una ventana o pestaña y devuelve un cuadro como PNG. Siempre suelta la captura al terminar. `null`
 * si la persona canceló o el navegador no pudo; quien llama muestra el aviso.
 */
export async function captureScreenFrame(): Promise<Blob | null> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Un cuadro después de empezar: el primero a veces sale negro
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
    return await canvasToBlob(canvas, "image/png");
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export type UploadedAttachment = {
  id: string;
  name: string;
  kind: AttachmentKind;
  bytes: number;
  width: number | null;
  height: number | null;
};

export type UploadResult =
  | { ok: true; attachment: UploadedAttachment }
  | { ok: false; error: AttachmentErrorCode | "network" };

const isCode = (value: unknown): value is AttachmentErrorCode =>
  typeof value === "string" && value in ATTACHMENT_ERROR_TEXTS;

/** El texto en llano de un error de subida (los códigos del servidor y el corte de red). */
export function uploadErrorText(error: AttachmentErrorCode | "network"): string {
  return error === "network"
    ? "No pudimos conectarnos y no se subió el archivo. Probá de nuevo."
    : ATTACHMENT_ERROR_TEXTS[error];
}

/** `POST /api/feedback-files` (multipart con `itemId` y `file`). Nunca tira: devuelve el código. */
export async function uploadAttachment(
  itemId: string,
  file: Blob,
  name: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.set("itemId", itemId);
  form.set("file", file, name);
  try {
    const res = await fetch("/api/feedback-files", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const body: unknown = await res.json().catch(() => null);
    if (body && typeof body === "object") {
      const b = body as { ok?: unknown; error?: unknown; attachment?: unknown };
      if (b.ok === true && b.attachment && typeof b.attachment === "object") {
        const a = b.attachment as Record<string, unknown>;
        if (
          typeof a.id === "string" &&
          typeof a.name === "string" &&
          typeof a.bytes === "number" &&
          (ATTACHMENT_KINDS as readonly unknown[]).includes(a.kind)
        ) {
          return {
            ok: true,
            attachment: {
              id: a.id,
              name: a.name,
              kind: a.kind as AttachmentKind,
              bytes: a.bytes,
              width: typeof a.width === "number" ? a.width : null,
              height: typeof a.height === "number" ? a.height : null,
            },
          };
        }
      }
      if (b.ok === false && isCode(b.error)) return { ok: false, error: b.error };
    }
    return { ok: false, error: res.status === 401 ? "no_session" : "server_error" };
  } catch {
    return { ok: false, error: "network" };
  }
}

/** `DELETE /api/feedback-files/[id]`. `true` si se borró. */
export async function deleteAttachment(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/feedback-files/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}
