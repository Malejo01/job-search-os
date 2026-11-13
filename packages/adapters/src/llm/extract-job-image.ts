import {
  ImageModelOutputSchema,
  parseImageExtraction,
  validateImageBytes,
  type ImageOffer,
} from "@job-search-os/pipeline";
import type { LlmClient } from "./types";

/** Tarea registrada en `model_routing` y en `llm_calls` (snake_case). */
export const EXTRACT_IMAGE_TASK = "extract_job_from_image";

/** Máximo de imágenes por persona en una ventana de 24 h (R6-3). */
export const IMAGE_DAILY_LIMIT = 10;

export type ExtractImageFailure =
  | "imagen_vacia"
  | "imagen_grande"
  | "imagen_formato"
  | "limite_imagenes"
  | "imagen_en_curso"
  | "tope_user"
  | "tope_global"
  | "modelo"
  | "no_es_aviso"
  | "salida_invalida";

export type ExtractImageOutcome =
  { ok: true; offers: ImageOffer[] } | { ok: false; code: ExtractImageFailure };

export type ExtractImageDeps = {
  llm: LlmClient;
  /** Llamadas de `extract_job_from_image` de esta persona desde `since` (de `llm_calls`). */
  countSince: (since: Date) => Promise<number>;
  /** Tope de gasto en USD: el global y LLM_USER_DAILY_CAP_USD (`spendCapReason`). */
  capReason: () => Promise<"global" | "user" | null>;
  /**
   * Una lectura a la vez por persona: sin esto, N imágenes en paralelo leen el mismo conteo y el
   * mismo gasto y pasan todas, porque `llm_calls` se escribe después de la respuesta. `acquire`
   * devuelve false si ya hay una en curso; `release` se llama siempre al terminar.
   */
  lock: { acquire: () => Promise<boolean>; release: () => Promise<void> };
  now?: () => Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lee un aviso desde una imagen. Orden: bytes de la imagen → tope de 10 por día → tope de gasto →
 * modelo → validación estricta de la salida (`parseImageExtraction`). Cada paso falla cerrado y no
 * llega al siguiente. La imagen solo viaja al proveedor: no se guarda, y esta función no loguea ni
 * la imagen ni el texto leído. Lo que devuelve es una propuesta: no crea nada; la persona revisa y
 * confirma (el modelo evalúa, el código decide).
 */
export async function extractJobFromImage(
  deps: ExtractImageDeps,
  input: { userId: string; image: Uint8Array },
): Promise<ExtractImageOutcome> {
  const bytes = validateImageBytes(input.image);
  if (!bytes.ok) {
    return {
      ok: false,
      code: { vacia: "imagen_vacia", grande: "imagen_grande", formato: "imagen_formato" }[
        bytes.reason
      ] as ExtractImageFailure,
    };
  }

  if (!(await deps.lock.acquire())) return { ok: false, code: "imagen_en_curso" };
  try {
    return await readLocked(deps, input);
  } finally {
    await deps.lock.release();
  }
}

async function readLocked(
  deps: ExtractImageDeps,
  input: { userId: string; image: Uint8Array },
): Promise<ExtractImageOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const used = await deps.countSince(new Date(now.getTime() - DAY_MS));
  if (used >= IMAGE_DAILY_LIMIT) return { ok: false, code: "limite_imagenes" };

  const cap = await deps.capReason();
  if (cap) return { ok: false, code: cap === "user" ? "tope_user" : "tope_global" };

  const res = await deps.llm.generateStructured(
    EXTRACT_IMAGE_TASK,
    ImageModelOutputSchema,
    {},
    { userId: input.userId, images: [{ mediaType: "image/jpeg", data: input.image }] },
  );
  if (!res.ok) return { ok: false, code: "modelo" };

  const parsed = parseImageExtraction(res.value.object);
  return parsed.ok ? { ok: true, offers: parsed.offers } : { ok: false, code: parsed.reason };
}
