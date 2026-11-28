/**
 * PDF del CV (R33-08, ADR-049): sale del mismo `CvDocument` que el DOCX y la vista previa. Composición
 * pura (`pdf-layout`) + serializador mínimo (`pdf-writer`). Determinista y sin I/O.
 */
import type { CvDocument } from "./model";
import { layoutCvPdf, type PdfLayout } from "./pdf-layout";
import { normalizeForPdf, type PdfSubstitution } from "./pdf-text";
import { writePdf } from "./pdf-writer";

export interface CvPdfResult {
  bytes: Uint8Array;
  pages: number;
  /** Caracteres que WinAnsi no tiene y qué quedó en su lugar; vacío si no hubo ninguno. */
  substitutions: PdfSubstitution[];
}

export function buildCvPdf(doc: CvDocument): CvPdfResult {
  const layout: PdfLayout = layoutCvPdf(doc);
  const title = doc.name ? `CV - ${normalizeForPdf(doc.name).text}` : "CV";
  const bytes = writePdf(layout, { title, lang: doc.lang });
  return { bytes, pages: layout.pages.length, substitutions: layout.substitutions };
}
