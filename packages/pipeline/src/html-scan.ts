/**
 * Lectura del HTML de emails en tiempo lineal. El HTML viene de afuera, así que acá no hay expresiones con
 * repeticiones abiertas que se reintenten desde cada apertura: se avanza con índices y, cuando no queda un
 * cierre más adelante, se deja de buscar.
 */

/** Largo máximo del HTML que se procesa. Más grande no es una alerta: va a la cola manual. */
export const MAX_EMAIL_HTML_CHARS = 1024 * 1024;

/** Reemplaza cada etiqueta, igual que `html.replace(/<[^>]+>/g, reemplazo)`. */
export function stripTags(html: string, replacement: string | ((tag: string) => string) = " ") {
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const open = html.indexOf("<", from);
    if (open < 0) break;
    const close = html.indexOf(">", open + 1);
    if (close < 0) break;
    if (close === open + 1) {
      parts.push(html.slice(from, close + 1));
    } else {
      const tag = html.slice(open, close + 1);
      parts.push(
        html.slice(from, open),
        typeof replacement === "string" ? replacement : replacement(tag),
      );
    }
    from = close + 1;
  }
  parts.push(html.slice(from));
  return parts.join("");
}

/** Saca los bloques `<script>` y `<style>` completos; uno sin cierre queda como está. */
export function stripScripts(html: string, replacement = " "): string {
  const open = /<(script|style)/gi;
  const closes: Record<string, RegExp> = { script: /<\/script>/gi, style: /<\/style>/gi };
  const unclosed = new Set<string>();
  const parts: string[] = [];
  let from = 0;
  for (;;) {
    const m = open.exec(html);
    if (!m) break;
    const tag = m[1]!.toLowerCase();
    if (unclosed.has(tag)) continue;
    const close = closes[tag]!;
    close.lastIndex = open.lastIndex;
    const end = close.exec(html);
    if (!end) {
      unclosed.add(tag);
      continue;
    }
    parts.push(html.slice(from, m.index), replacement);
    from = end.index + end[0].length;
    open.lastIndex = from;
  }
  parts.push(html.slice(from));
  return parts.join("");
}

export type TagBlock = {
  /** Lo que hay entre el nombre de la etiqueta y el primer `>`. */
  attrs: string;
  inner: string;
  start: number;
  end: number;
};

export type TagBlockOptions = {
  /** Qué tiene que seguir al nombre: `any` (como `<h3[^>]*>`), un espacio, o un espacio o el cierre. */
  boundary?: "any" | "space" | "spaceOrClose";
  /** Solo los bloques cuyos atributos cumplen esto. */
  attrs?: (attrs: string) => boolean;
  /** Etiqueta que cierra el bloque, si no es la misma que lo abre. */
  closeTag?: string;
  caseSensitive?: boolean;
  limit?: number;
};

const BOUNDARIES = { any: "", space: "(?=\\s)", spaceOrClose: "(?=[\\s>])" } as const;

/** Bloques `<tag …>…</tag>` en orden, con el primer cierre después de cada apertura. */
export function tagBlocks(html: string, tag: string, options: TagBlockOptions = {}): TagBlock[] {
  const flags = options.caseSensitive ? "g" : "gi";
  const open = new RegExp(`<${tag}${BOUNDARIES[options.boundary ?? "any"]}`, flags);
  const close = new RegExp(`</${options.closeTag ?? tag}>`, flags);
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const blocks: TagBlock[] = [];
  let from = 0;
  while (blocks.length < limit) {
    open.lastIndex = from;
    const m = open.exec(html);
    if (!m) break;
    const attrsStart = m.index + m[0].length;
    const tagEnd = html.indexOf(">", attrsStart);
    if (tagEnd < 0) break;
    const attrs = html.slice(attrsStart, tagEnd);
    if (options.attrs && !options.attrs(attrs)) {
      from = tagEnd + 1;
      continue;
    }
    close.lastIndex = tagEnd + 1;
    const end = close.exec(html);
    if (!end) break;
    const blockEnd = end.index + end[0].length;
    blocks.push({ attrs, inner: html.slice(tagEnd + 1, end.index), start: m.index, end: blockEnd });
    from = blockEnd;
  }
  return blocks;
}

/** Reemplaza los bloques completos de una etiqueta. */
export function removeBlocks(html: string, tag: string, replacement: string): string {
  const parts: string[] = [];
  let from = 0;
  for (const block of tagBlocks(html, tag)) {
    parts.push(html.slice(from, block.start), replacement);
    from = block.end;
  }
  parts.push(html.slice(from));
  return parts.join("");
}
