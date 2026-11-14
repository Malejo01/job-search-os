import {
  checkProfileReadText,
  classifyCvUpload,
  CV_MAX_DOCX_INFLATED_BYTES,
  readDocxText,
  type InflateRaw,
  type ProfileReadInputProblem,
} from "@job-search-os/pipeline";

/**
 * Texto de un CV en el navegador (ADR-034 §9, R10-1). El archivo se lee acá y NO se sube: al servidor solo
 * llega el texto, después de que la persona lo revisa. DOCX sin librerías (`DecompressionStream` más el
 * lector de `@job-search-os/pipeline`); el PDF todavía no tiene lector (ADR-034 §11, depende de
 * `pdfjs-dist`): se le pide pegar el texto.
 */
export type ExtractedCv =
  { ok: true; text: string } | { ok: false; problem: ProfileReadInputProblem };

/** Deflate crudo con tope de salida: corta en cuanto se pasa de `maxBytes` (bomba de descompresión). */
const inflateRaw: InflateRaw = async (data, maxBytes) => {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data.slice()])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > Math.min(maxBytes, CV_MAX_DOCX_INFLATED_BYTES)) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  } catch {
    return null;
  }
};

export async function extractCvText(file: File): Promise<ExtractedCv> {
  const kind = classifyCvUpload(file);
  if (!kind.ok) return { ok: false, problem: kind.error };
  // PDF: sin lector en el navegador por ahora. No se lee el archivo siquiera
  if (kind.value === "pdf") return { ok: false, problem: "pdf_paste" };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  const docx = await readDocxText(bytes, inflateRaw);
  if (!docx.ok) return { ok: false, problem: docx.error };
  const checked = checkProfileReadText(docx.value, "file");
  return checked.ok ? { ok: true, text: checked.value } : { ok: false, problem: checked.error };
}
