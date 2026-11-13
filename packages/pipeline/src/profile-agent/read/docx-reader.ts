/**
 * Texto de un DOCX a partir de sus bytes, sin dependencias (ADR-034 §11). El navegador lo corre sobre el
 * archivo que la persona eligió; el archivo no se sube. Puro: la descompresión (`DecompressionStream` en el
 * navegador, `zlib` en los tests) entra como función, así este módulo no depende de ningún API de ejecución.
 *
 * Falla cerrado: macros, OLE viejo, ZIP que no es un DOCX, entradas cifradas, bombas de descompresión y
 * un `document.xml` con `<!DOCTYPE` (XXE) devuelven un problema tipado, nunca texto parcial.
 */
import { CV_MAX_DOCX_INFLATED_BYTES } from "../../cv/limits";
import { docxXmlToText } from "../../cv/docx-text";
import { docxContentTypesOk, sniffCvFile } from "../../cv/sniff";
import { err, ok, type Result } from "../../result";
import type { ProfileReadInputProblem } from "./upload";
import { findZipEntry, type ZipEntry } from "./zip-entry";

/** Descomprime deflate crudo; `null` si falla o supera `maxBytes` al inflar. */
export type InflateRaw = (data: Uint8Array, maxBytes: number) => Promise<Uint8Array | null>;

export type DocxReadProblem = Extract<
  ProfileReadInputProblem,
  "empty" | "too_large" | "legacy_doc" | "macro_enabled" | "not_docx" | "unreadable" | "pdf_paste"
>;

async function entryBytes(
  bytes: Uint8Array,
  entry: ZipEntry,
  inflate: InflateRaw,
): Promise<Uint8Array | null> {
  const raw = bytes.subarray(entry.start, entry.end);
  if (entry.method === 0) return raw;
  const out = await inflate(raw, CV_MAX_DOCX_INFLATED_BYTES);
  // El tamaño declarado lo cumple quien descomprime: un archivo que infla más de lo que dice, es sospechoso
  if (out === null || out.length > CV_MAX_DOCX_INFLATED_BYTES) return null;
  return out;
}

async function entryText(
  bytes: Uint8Array,
  name: string,
  inflate: InflateRaw,
): Promise<Result<string, DocxReadProblem>> {
  const entry = findZipEntry(bytes, name);
  if (!entry.ok) return err("not_docx");
  const data = await entryBytes(bytes, entry.value, inflate);
  if (data === null) return err("not_docx");
  try {
    return ok(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    return err("not_docx");
  }
}

export async function readDocxText(
  bytes: Uint8Array,
  inflate: InflateRaw,
): Promise<Result<string, DocxReadProblem>> {
  const kind = sniffCvFile(bytes);
  if (!kind.ok) {
    switch (kind.error) {
      case "empty":
        return err("empty");
      case "too_large":
        return err("too_large");
      case "ole_legacy":
        return err("legacy_doc");
      case "macro_enabled":
        return err("macro_enabled");
      default:
        return err("not_docx");
    }
  }
  // Un archivo que se llama .docx pero es un PDF: el camino es pegar el texto
  if (kind.value === "pdf") return err("pdf_paste");

  const types = await entryText(bytes, "[Content_Types].xml", inflate);
  if (!types.ok) return err(types.error);
  const typesCheck = docxContentTypesOk(types.value);
  if (!typesCheck.ok)
    return err(typesCheck.error === "macro_enabled" ? "macro_enabled" : "not_docx");

  const doc = await entryText(bytes, "word/document.xml", inflate);
  if (!doc.ok) return err(doc.error);
  const text = docxXmlToText(doc.value);
  if (!text.ok) return err(text.error === "empty" ? "unreadable" : "not_docx");
  return ok(text.value);
}
