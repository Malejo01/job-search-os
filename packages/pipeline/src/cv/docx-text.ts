import { err, ok, type Result } from "../result";
import { CV_MAX_DOCX_INFLATED_BYTES } from "./limits";

export type DocxTextError = "doctype_forbidden" | "empty" | "too_large";

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|(lt|gt|amp|quot|apos));/g,
    (m, dec, hex, named) => {
      if (named) return ENTITIES[named as string]!;
      const code = dec ? Number.parseInt(dec as string, 10) : Number.parseInt(hex as string, 16);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "";
      return String.fromCodePoint(code);
    },
  );
}

// Una sola pasada sobre las etiquetas que importan; todo lo demás se ignora. Sin parser XML.
// Los atributos se acotan a 200 caracteres: con XML hostil (miles de aperturas sin `>`) evita el costo cuadrático.
const TOKEN_RE =
  /<w:t(?:\s[^>]{0,200})?>([^<]*)<\/w:t>|<\/w:p>|<w:br(?:\s[^>]{0,200})?\/?>|<w:cr\s{0,20}\/?>|<w:tab\s{0,20}\/>|<w:tc(?:\s[^>]{0,200})?>/g;

/** Saca los bloques `mc:Fallback` con indexOf; si uno no cierra, corta el texto ahí. */
function stripFallback(xml: string): string {
  const open = "<mc:Fallback";
  const close = "</mc:Fallback>";
  let out = "";
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) return out + xml.slice(pos);
    const next = xml[start + open.length];
    if (next !== " " && next !== ">" && next !== "\n" && next !== "\t" && next !== "\r") {
      out += xml.slice(pos, start + open.length);
      pos = start + open.length;
      continue;
    }
    out += xml.slice(pos, start);
    const end = xml.indexOf(close, start);
    if (end < 0) return out;
    pos = end + close.length;
  }
}

/**
 * `<w:t>` → texto; `</w:p>` y `<w:br/>` → \n; `<w:tab/>` y `<w:tc>` → \t. `w:txbxContent` sale solo
 * porque lleva sus propios `<w:p>`/`<w:t>`. Se descarta `mc:Fallback`, que repite el contenido de las
 * cajas de texto. Con `<!DOCTYPE` o `<!ENTITY` falla (XXE / expansión de entidades).
 */
export function docxXmlToText(xml: string): Result<string, DocxTextError> {
  if (xml.length > CV_MAX_DOCX_INFLATED_BYTES) return err("too_large");
  if (/<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) return err("doctype_forbidden");
  const body = stripFallback(xml);
  let out = "";
  for (const m of body.matchAll(TOKEN_RE)) {
    const tag = m[0];
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (tag === "</w:p>" || tag.startsWith("<w:br") || tag.startsWith("<w:cr")) out += "\n";
    else out += "\t"; // <w:tab/> y <w:tc>
  }
  if (out.replace(/\s+/g, "") === "") return err("empty");
  return ok(out);
}
