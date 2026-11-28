/**
 * Serializador PDF mínimo del CV (R33-08, ADR-049), sin dependencias. Escribe PDF 1.4 con:
 *  - las fuentes estándar Helvetica y Helvetica-Bold (no se incrustan: todo lector las trae) con
 *    codificación WinAnsi, así que tildes, eñes y «¿¡» salen bien;
 *  - texto real (operadores `Tj`), seleccionable y copiable, no una imagen;
 *  - links como anotaciones `/Link` con acción `/URI` (solo `https:`, `http:` y `mailto:`);
 *  - sin compresión, sin imágenes, sin scripts, sin fecha: misma entrada, mismos bytes.
 * Falla cerrado: un carácter que WinAnsi no tiene o un link raro lanzan un error, nunca salen rotos.
 */
import type { PdfLayout } from "./pdf-layout";
import { winAnsiByte } from "./pdf-text";

export interface PdfMeta {
  /** Título del documento (metadatos). */
  title: string;
  /** `es` o `en`. */
  lang: string;
}

const SAFE_URI_RE = /^(?:https?:\/\/|mailto:)[\x21-\x7e]+$/i;

function num(n: number): string {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, "") || "0";
}

/** Texto WinAnsi como cadena literal de PDF: cada carácter es un byte (0–255). */
function literal(text: string): string {
  let out = "(";
  for (const ch of text) {
    const b = winAnsiByte(ch);
    if (b === null) throw new Error("pdf: carácter fuera de WinAnsi");
    const c = String.fromCharCode(b);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return out + ")";
}

/** URI como cadena literal (solo ASCII visible, ya validado). */
function uriLiteral(url: string): string {
  if (!SAFE_URI_RE.test(url)) throw new Error("pdf: link no permitido");
  return `(${url.replace(/[()\\]/g, (c) => `\\${c}`)})`;
}

/** UTF-16BE con BOM como cadena hexadecimal (los títulos de los metadatos pueden llevar cualquier carácter). */
function hexUtf16(text: string): string {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) {
    hex += text.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
  }
  return `<${hex}>`;
}

function contentStream(page: PdfLayout["pages"][number], pageHeight: number): string {
  const ops: string[] = ["0 g"];
  for (const line of page.lines) {
    if (line.text === "") continue;
    const font = line.font === "bold" ? "/F2" : "/F1";
    ops.push(
      "BT",
      `${font} ${num(line.size)} Tf`,
      `1 0 0 1 ${num(line.x)} ${num(pageHeight - line.baseline)} Tm`,
      `${literal(line.text)} Tj`,
      "ET",
    );
  }
  return ops.join("\n");
}

/** Bytes del PDF a partir de la composición. */
export function writePdf(layout: PdfLayout, meta: PdfMeta): Uint8Array {
  const { pages, pageWidth, pageHeight } = layout;
  // Numeración fija: 1 catálogo, 2 páginas, 3 y 4 fuentes, 5 info; después, por página: página, contenido y links
  const FIRST_PAGE_OBJ = 6;
  const pageIds: number[] = [];
  const objects: { id: number; body: string }[] = [];
  let next = FIRST_PAGE_OBJ;

  const pageObjs: { page: number; content: number; annots: number[] }[] = pages.map((p) => {
    const page = next++;
    const content = next++;
    const annots = p.lines.flatMap((l) => l.links).map(() => next++);
    pageIds.push(page);
    return { page, content, annots };
  });

  pages.forEach((p, i) => {
    const ids = pageObjs[i]!;
    const stream = contentStream(p, pageHeight);
    objects.push({
      id: ids.page,
      body:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageWidth)} ${num(pageHeight)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${ids.content} 0 R` +
        (ids.annots.length > 0 ? ` /Annots [${ids.annots.map((a) => `${a} 0 R`).join(" ")}]` : "") +
        ` >>`,
    });
    objects.push({
      id: ids.content,
      body: `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    });
    let k = 0;
    for (const line of p.lines) {
      for (const link of line.links) {
        const top = pageHeight - line.baseline + line.size * 0.78;
        const bottom = pageHeight - line.baseline - line.size * 0.22;
        objects.push({
          id: ids.annots[k++]!,
          body:
            `<< /Type /Annot /Subtype /Link /Rect [${num(link.x)} ${num(bottom)} ${num(link.x + link.width)} ${num(top)}] ` +
            `/Border [0 0 0] /F 4 /A << /S /URI /URI ${uriLiteral(link.url)} >> >>`,
        });
      }
    }
  });

  const fixed: { id: number; body: string }[] = [
    {
      id: 1,
      body: `<< /Type /Catalog /Pages 2 0 R /Lang ${literal(meta.lang === "en" ? "en" : "es")} >>`,
    },
    {
      id: 2,
      body: `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    },
    {
      id: 3,
      body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    },
    {
      id: 4,
      body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    },
    { id: 5, body: `<< /Title ${hexUtf16(meta.title)} >>` },
  ];
  const all = [...fixed, ...objects].sort((a, b) => a.id - b.id);

  // Cadena binaria: cada carácter es un byte, así que la longitud es el desplazamiento
  let out = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = new Map<number, number>();
  for (const o of all) {
    offsets.set(o.id, out.length);
    out += `${o.id} 0 obj\n${o.body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`;
  for (const o of all) out += `${String(offsets.get(o.id)).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${all.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i);
    if (c > 0xff) throw new Error("pdf: byte fuera de rango");
    bytes[i] = c;
  }
  return bytes;
}
