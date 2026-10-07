/**
 * Markdown mínimo para los textos legales: puro, sin I/O. Recibe texto y devuelve un árbol de
 * nodos; el render a React vive en apps/web (nunca se genera HTML como string).
 * Soporta: títulos #/##/###, párrafos, listas `-` y `1.`, **negrita**, `código`,
 * [texto](url) (solo https: y rutas internas) y tablas simples con `|`.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "quote"; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "table"; header: InlineNode[][]; rows: InlineNode[][][] };

export type LegalDocument = {
  meta: Record<string, string>;
  blocks: BlockNode[];
};

/** Solo `https:` y rutas internas `/…` (no `//host`, que es protocolo relativo). */
export function isSafeHref(href: string): boolean {
  const h = href.trim();
  if (/\s/.test(h) || [...h].some((c) => c.charCodeAt(0) < 32)) return false;
  if (h.includes("\\") || h.startsWith("//")) return false; // "/\host" lo normalizan los navegadores a "//host"
  if (h.startsWith("/")) return true;
  return /^https:\/\/[^/]/i.test(h);
}

export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*[\]()|]/.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: "code", text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]]+)\]\(([^)\s]*)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const children = parseInline(m[1]!);
        if (isSafeHref(m[2]!)) out.push({ type: "link", href: m[2]!.trim(), children });
        else out.push(...children); // link no permitido: queda solo el texto
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function splitRow(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    if (t[i] === "\\" && t[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (t[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const isTableRow = (l: string) => l.includes("|");

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { meta: {}, body: lines.join("\n") };
  const end = lines.findIndex((l, idx) => idx > 0 && l.trim() === "---");
  if (end < 0) return { meta: {}, body: lines.join("\n") };
  const meta: Record<string, string> = {};
  for (const l of lines.slice(1, end)) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
    if (m) meta[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: lines.slice(end + 1).join("\n") };
}

export function parseLegalMarkdown(text: string): LegalDocument {
  const { meta, body } = parseFrontmatter(text);
  const lines = body.split("\n");
  const blocks: BlockNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({
        type: "heading",
        level: h[1]!.length as 1 | 2 | 3,
        children: parseInline(h[2]!),
      });
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const header = splitRow(line).map(parseInline);
      i += 2;
      const rows: InlineNode[][][] = [];
      while (i < lines.length && lines[i]!.trim() && isTableRow(lines[i]!)) {
        const cells = splitRow(lines[i]!).map(parseInline);
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }
    const li = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (li) {
      const ordered = li[2] !== undefined;
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const m = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(lines[i]!);
        if (m && (m[2] !== undefined) === ordered) {
          items.push(parseInline(m[3]!));
          i++;
        } else if (m === null && /^\s{2,}\S/.test(lines[i]!) && items.length) {
          // continuación de un ítem
          items[items.length - 1]!.push(...parseInline(" " + lines[i]!.trim()));
          i++;
        } else break;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^\s*>\s?/, "").trim());
        i++;
      }
      blocks.push({ type: "quote", children: parseInline(quoted.join(" ").trim()) });
      continue;
    }
    // La primera línea se consume siempre (aunque parezca un título o lista vacíos, p. ej. "# "):
    // así cada vuelta del bucle externo avanza al menos una línea.
    const para: string[] = [line.trim()];
    i++;
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !/^#{1,3}\s/.test(lines[i]!) &&
      !/^\s*>/.test(lines[i]!) &&
      !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
  }
  return { meta, blocks };
}
