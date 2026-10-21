import { err, ok, type Result } from "../result";
import { CV_MAX_FILE_BYTES, CV_MAX_ZIP_ENTRIES } from "./limits";

export type CvFileKind = "pdf" | "docx";
export type CvSniffError =
  "empty" | "too_large" | "ole_legacy" | "macro_enabled" | "zip_not_docx" | "unknown";

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_WINDOW = 1024;
const EOCD_MIN = 22;
const EOCD_MAX_BACK = 65_557; // 22 + comentario máximo de 65535

const startsWith = (b: Uint8Array, magic: readonly number[], at = 0): boolean =>
  b.length >= at + magic.length && magic.every((v, i) => b[at + i] === v);

const u16 = (b: Uint8Array, at: number): number => b[at]! | (b[at + 1]! << 8);
const u32 = (b: Uint8Array, at: number): number =>
  (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;

function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length, PDF_WINDOW) - PDF_MAGIC.length;
  for (let i = 0; i <= end; i++) if (startsWith(bytes, PDF_MAGIC, i)) return true;
  return false;
}

/** Nombres del directorio central (se lee sin descomprimir). `null` si la estructura no es válida. */
function zipEntryNames(bytes: Uint8Array): { names: string[]; tooMany: boolean } | null {
  if (bytes.length < EOCD_MIN) return null;
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - EOCD_MAX_BACK);
  for (let i = bytes.length - EOCD_MIN; i >= lowest; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = u16(bytes, eocd + 10);
  let pos = u32(bytes, eocd + 16);
  if (total > CV_MAX_ZIP_ENTRIES) return { names: [], tooMany: true };
  const decoder = new TextDecoder("utf-8");
  const names: string[] = [];
  for (let n = 0; n < total; n++) {
    if (pos + 46 > bytes.length || !startsWith(bytes, [0x50, 0x4b, 0x01, 0x02], pos)) return null;
    const nameLen = u16(bytes, pos + 28);
    const extraLen = u16(bytes, pos + 30);
    const commentLen = u16(bytes, pos + 32);
    if (pos + 46 + nameLen > bytes.length) return null;
    names.push(decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return { names, tooMany: false };
}

/**
 * Tipo por contenido, nunca por extensión ni MIME. PDF: `%PDF-` en los primeros 1024 bytes.
 * DOCX: `PK\x03\x04` al inicio y, en el directorio central del ZIP, `word/document.xml` y
 * `[Content_Types].xml`. Rechaza macros (`vbaProject`), OLE y ZIP con demasiadas entradas.
 * Un ZIP nunca se clasifica como PDF, aunque traiga `%PDF-` adentro.
 */
export function sniffCvFile(bytes: Uint8Array): Result<CvFileKind, CvSniffError> {
  if (bytes.length === 0) return err("empty");
  if (bytes.length > CV_MAX_FILE_BYTES) return err("too_large");
  if (startsWith(bytes, OLE_MAGIC)) return err("ole_legacy");
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const zip = zipEntryNames(bytes);
    if (!zip || zip.tooMany) return err("zip_not_docx");
    const lower = zip.names.map((n) => n.toLowerCase());
    if (lower.some((n) => n.includes("vbaproject"))) return err("macro_enabled");
    if (!zip.names.includes("word/document.xml") || !zip.names.includes("[Content_Types].xml")) {
      return err("zip_not_docx");
    }
    return ok("docx");
  }
  if (hasPdfHeader(bytes)) return ok("pdf");
  return err("unknown");
}

/**
 * Chequeo de `[Content_Types].xml`, que descomprime el lector del navegador (CV-04): tiene que declarar
 * el documento de Word y no la variante con macros.
 */
export function docxContentTypesOk(xml: string): Result<true, "macro_enabled" | "zip_not_docx"> {
  if (/macroenabled/i.test(xml)) return err("macro_enabled");
  if (!xml.includes("wordprocessingml.document.main+xml")) return err("zip_not_docx");
  return ok(true);
}
