import {
  checkProfileReadText,
  classifyCvUpload,
  CV_MAX_DOCX_INFLATED_BYTES,
  PROFILE_READ_MAX_RAW_TEXT_CHARS,
  readDocxText,
  sniffCvFile,
  type InflateRaw,
  type ProfileReadInputProblem,
} from "@job-search-os/pipeline";
import type * as PdfjsModule from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Texto de un CV en el navegador (ADR-034 §9, R10-1). El archivo se lee acá y NO se sube: al servidor solo
 * llega el texto, después de que la persona lo revisa. DOCX sin librerías (`DecompressionStream` más el
 * lector de `@job-search-os/pipeline`). PDF con `pdfjs-dist` (D3, R12-12), que se carga con import dinámico
 * solo cuando la persona elige un PDF: el resto de la app no lo descarga.
 *
 * Los dos formatos terminan en `checkProfileReadText(…, "file")`: mismos límites (`CV_MIN_TEXT_CHARS` y
 * `CV_MAX_TEXT_CHARS`) y mismo mensaje cuando no hay texto (PDF escaneado o imagen → pegar el texto).
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

// ---------------------------------------------------------------------------
// PDF (R12-12)
// ---------------------------------------------------------------------------

/** El build «legacy» de pdfjs: sin `eval` ni `new Function`, y anda en navegadores no tan nuevos. */
export type Pdfjs = typeof PdfjsModule;
/** Carga pdfjs; `null` si no se pudo (sin red, navegador viejo). Se inyecta para probarlo en Node. */
export type LoadPdfjs = () => Promise<Pdfjs | null>;

/** Un CV no tiene 30 páginas: más que eso no se lee (y no se gasta memoria en un PDF hostil). */
export const CV_PDF_MAX_PAGES = 30;

/**
 * pdfjs en el navegador. El worker lo emite el bundler como un archivo más del propio sitio
 * (`/_next/static/media/…`, con hash de contenido): sin CDN, sin orígenes nuevos y siempre de la misma
 * versión que la librería. La CSP actual (`frame-ancestors 'none'`) no restringe scripts ni workers.
 */
const loadPdfjsInBrowser: LoadPdfjs = async () => {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    return pdfjs;
  } catch {
    return null;
  }
};

/** Una pieza de texto de pdfjs (`TextItem`); las marcas de contenido no traen `str`. */
type TextPiece = { str?: unknown; hasEOL?: unknown };

/**
 * Texto de las piezas de una página, en el orden del archivo: cada fin de línea de pdfjs (`hasEOL`) es un
 * salto. Sin reordenar columnas: lo que no quede bien, la persona lo ve y lo corrige en el cuadro.
 */
export function pdfPageText(items: readonly TextPiece[]): string {
  let out = "";
  for (const item of items) {
    if (typeof item.str === "string") out += item.str;
    if (item.hasEOL === true) out += "\n";
  }
  return out;
}

/**
 * Texto de un PDF (bytes ya leídos). Falla cerrado: si pdfjs no carga, el camino es pegar el texto
 * (`pdf_paste`); si el PDF está dañado, tiene clave o no trae texto (escaneado), `unreadable`. Nunca
 * devuelve texto a medias de un PDF que falló al leerse.
 */
export async function readPdfText(
  bytes: Uint8Array,
  loadPdfjs: LoadPdfjs = loadPdfjsInBrowser,
): Promise<ExtractedCv> {
  const kind = sniffCvFile(bytes);
  // Se llama .pdf pero no lo es (o es un DOCX renombrado): no se le pasa a pdfjs
  if (!kind.ok || kind.value !== "pdf") return { ok: false, problem: "unreadable" };

  const pdfjs = await loadPdfjs();
  if (!pdfjs) return { ok: false, problem: "pdf_paste" };

  // pdfjs se queda con el buffer (lo transfiere al worker): se le pasa una copia
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    // Solo texto: sin fuentes del sistema ni @font-face, sin XFA, sin pedidos de red de rango
    // Sin eval: pdfjs 6.x ya no compila funciones del PDF con `new Function` y quitó la opción `isEvalSupported`
    // (ni los tipos la aceptan). extract-text-pdfjs-options.test.ts falla si el build instalado vuelve a usar eval.
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    verbosity: 0,
  });
  let text = "";
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, CV_PDF_MAX_PAGES);
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      text += `${pdfPageText(content.items as TextPiece[])}\n\n`;
      page.cleanup();
      // Pasarse del largo crudo ya es «demasiado largo»: no se sigue leyendo
      if (text.length > PROFILE_READ_MAX_RAW_TEXT_CHARS) {
        return { ok: false, problem: "text_too_long" };
      }
    }
  } catch {
    // Dañado, con contraseña o con una estructura que pdfjs no entiende
    return { ok: false, problem: "unreadable" };
  } finally {
    void task.destroy();
  }
  const checked = checkProfileReadText(text, "file");
  return checked.ok ? { ok: true, text: checked.value } : { ok: false, problem: checked.error };
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

export async function extractCvText(file: File, loadPdfjs?: LoadPdfjs): Promise<ExtractedCv> {
  const kind = classifyCvUpload(file);
  if (!kind.ok) return { ok: false, problem: kind.error };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  if (kind.value === "pdf") return readPdfText(bytes, loadPdfjs);

  const docx = await readDocxText(bytes, inflateRaw);
  if (!docx.ok) return { ok: false, problem: docx.error };
  const checked = checkProfileReadText(docx.value, "file");
  return checked.ok ? { ok: true, text: checked.value } : { ok: false, problem: checked.error };
}
