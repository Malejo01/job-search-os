/**
 * Texto del PDF del CV (R33-08, ADR-049): codificación WinAnsi (la de las fuentes estándar Helvetica y
 * Helvetica-Bold, que cubre tildes, eñes y «¿¡») y anchos de carácter para partir líneas. Puro.
 *
 * Los caracteres que WinAnsi no tiene se reemplazan por el equivalente más cercano y se INFORMAN
 * (`PdfSubstitution`): nunca queda un carácter roto en silencio. Los anchos son los de las métricas AFM
 * estándar para ASCII y Latin-1; los pocos símbolos raros llevan un valor aproximado (solo afecta dónde se
 * parte una línea, nunca el texto).
 */

export type PdfFont = "regular" | "bold";

/** Caracteres fuera de Latin-1 que WinAnsi sí tiene (0x80–0x9F), con su byte. */
const WINANSI_SPECIAL: ReadonlyMap<string, number> = new Map([
  ["€", 0x80],
  ["‚", 0x82],
  ["ƒ", 0x83],
  ["„", 0x84],
  ["…", 0x85],
  ["†", 0x86],
  ["‡", 0x87],
  ["ˆ", 0x88],
  ["‰", 0x89],
  ["Š", 0x8a],
  ["‹", 0x8b],
  ["Œ", 0x8c],
  ["Ž", 0x8e],
  ["‘", 0x91],
  ["’", 0x92],
  ["“", 0x93],
  ["”", 0x94],
  ["•", 0x95],
  ["–", 0x96],
  ["—", 0x97],
  ["˜", 0x98],
  ["™", 0x99],
  ["š", 0x9a],
  ["›", 0x9b],
  ["œ", 0x9c],
  ["ž", 0x9e],
  ["Ÿ", 0x9f],
]);

const WINANSI_BY_BYTE: ReadonlyMap<number, string> = new Map(
  [...WINANSI_SPECIAL].map(([ch, b]) => [b, ch]),
);

/** Reemplazos a mano de lo que NFD/NFKC no resuelve. */
const LOOKALIKES: ReadonlyMap<string, string> = new Map([
  ["‐", "-"],
  ["‑", "-"],
  ["‒", "-"],
  ["―", "—"],
  ["−", "-"],
  ["‧", "·"],
  ["′", "'"],
  ["″", '"'],
  ["‵", "'"],
  ["‛", "'"],
  ["‟", '"'],
  ["〝", '"'],
  ["〞", '"'],
  ["→", "->"],
  ["←", "<-"],
  ["⇒", "=>"],
  ["≤", "<="],
  ["≥", ">="],
  ["≠", "!="],
  ["★", "*"],
  ["✓", "v"],
  ["✔", "v"],
  ["▪", "•"],
  ["●", "•"],
  ["◦", "•"],
  ["○", "•"],
  ["Ł", "L"],
  ["ł", "l"],
  ["Đ", "D"],
  ["đ", "d"],
  ["ı", "i"],
]);

/** Espacios de otros anchos (U+2000 a U+200A, U+202F, U+205F, U+3000): pasan a espacio común. */
const SPACE_LIKE_RE = new RegExp("^[\\u2000-\\u200a\\u202f\\u205f\\u3000]$");

/** ¿WinAnsi tiene este carácter? */
export function isWinAnsi(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  if (ch.length > 2) return false;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_SPECIAL.has(ch);
}

/** Byte WinAnsi de un carácter, o `null` si no lo tiene. */
export function winAnsiByte(ch: string): number | null {
  const c = ch.codePointAt(0)!;
  if (ch.length > 2) return null;
  if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff)) return c;
  return WINANSI_SPECIAL.get(ch) ?? null;
}

/** Carácter de un byte WinAnsi (para leer de vuelta el texto de un PDF en las pruebas). */
export function winAnsiChar(byte: number): string {
  if ((byte >= 0x20 && byte <= 0x7e) || (byte >= 0xa0 && byte <= 0xff)) {
    return String.fromCharCode(byte);
  }
  return WINANSI_BY_BYTE.get(byte) ?? "?";
}

export interface PdfSubstitution {
  /** El carácter original, como punto de código (`U+0141`): sin imprimir el texto de la persona. */
  codePoint: string;
  /** Lo que quedó en su lugar. */
  replacement: string;
  /** `closest` = hay un equivalente razonable; `unmapped` = no lo hay y quedó «?». */
  kind: "closest" | "unmapped";
  count: number;
}

export interface PdfTextNormalized {
  text: string;
  substitutions: PdfSubstitution[];
}

function stripMarks(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function allWinAnsi(s: string): boolean {
  for (const ch of s) if (!isWinAnsi(ch)) return false;
  return true;
}

function closest(ch: string): string | null {
  const direct = LOOKALIKES.get(ch);
  if (direct !== undefined) return direct;
  const noMarks = stripMarks(ch);
  if (noMarks !== "" && allWinAnsi(noMarks)) return noMarks;
  const compat = ch.normalize("NFKC");
  if (compat !== ch && compat !== "" && allWinAnsi(compat)) return compat;
  const compatNoMarks = stripMarks(compat);
  if (compatNoMarks !== "" && allWinAnsi(compatNoMarks)) return compatNoMarks;
  return null;
}

/**
 * Deja el texto con caracteres que WinAnsi tiene. Saltos de línea y tabulaciones pasan a espacio (sin
 * informar: no son un carácter perdido); espacios raros, a espacio común. Lo demás que no entra se
 * reemplaza por lo más parecido o por «?», y siempre se informa.
 */
export function normalizeForPdf(input: string): PdfTextNormalized {
  const found = new Map<string, PdfSubstitution>();
  let out = "";
  for (const ch of input.normalize("NFC")) {
    if (isWinAnsi(ch)) {
      out += ch;
      continue;
    }
    if (/^[\t\n\r\f\v]$/.test(ch) || SPACE_LIKE_RE.test(ch)) {
      out += " ";
      continue;
    }
    const near = closest(ch);
    const replacement = near ?? "?";
    out += replacement;
    const prev = found.get(ch);
    if (prev) prev.count += 1;
    else {
      found.set(ch, {
        codePoint: `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
        replacement,
        kind: near === null ? "unmapped" : "closest",
        count: 1,
      });
    }
  }
  return { text: out, substitutions: [...found.values()] };
}

// Anchos (milésimas de em) de ASCII 0x20–0x7E.
const REGULAR_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// [regular, negrita] de los símbolos de Latin-1 y de 0x80–0x9F que no son letras con tilde.
const EXTRA_WIDTHS: ReadonlyMap<string, readonly [number, number]> = new Map([
  [" ", [278, 278]],
  ["¡", [333, 333]],
  ["¢", [556, 556]],
  ["£", [556, 556]],
  ["¤", [556, 556]],
  ["¥", [556, 556]],
  ["¦", [260, 280]],
  ["§", [556, 556]],
  ["¨", [333, 333]],
  ["©", [737, 737]],
  ["ª", [370, 370]],
  ["«", [556, 556]],
  ["¬", [584, 584]],
  ["­", [333, 333]],
  ["®", [737, 737]],
  ["¯", [333, 333]],
  ["°", [400, 400]],
  ["±", [584, 584]],
  ["²", [333, 333]],
  ["³", [333, 333]],
  ["´", [333, 333]],
  ["µ", [556, 611]],
  ["¶", [537, 556]],
  ["·", [278, 278]],
  ["¸", [333, 333]],
  ["¹", [333, 333]],
  ["º", [365, 365]],
  ["»", [556, 556]],
  ["¼", [834, 834]],
  ["½", [834, 834]],
  ["¾", [834, 834]],
  ["¿", [611, 611]],
  ["×", [584, 584]],
  ["÷", [584, 584]],
  ["Æ", [1000, 1000]],
  ["æ", [889, 889]],
  ["Ð", [722, 722]],
  ["ð", [556, 611]],
  ["Ø", [778, 778]],
  ["ø", [611, 611]],
  ["Þ", [667, 667]],
  ["þ", [556, 611]],
  ["ß", [611, 611]],
  ["Œ", [1000, 1000]],
  ["œ", [944, 944]],
  ["€", [556, 556]],
  ["‚", [222, 278]],
  ["ƒ", [556, 556]],
  ["„", [333, 500]],
  ["…", [1000, 1000]],
  ["†", [556, 556]],
  ["‡", [556, 556]],
  ["ˆ", [333, 333]],
  ["‰", [1000, 1000]],
  ["‹", [333, 333]],
  ["‘", [222, 278]],
  ["’", [222, 278]],
  ["“", [333, 500]],
  ["”", [333, 500]],
  ["•", [350, 350]],
  ["–", [556, 556]],
  ["—", [1000, 1000]],
  ["˜", [333, 333]],
  ["™", [1000, 1000]],
  ["›", [333, 333]],
  ["Ÿ", [667, 667]],
]);

/** Ancho de un carácter en milésimas de em. Para un carácter que WinAnsi no tiene, el de «?». */
export function charWidth(ch: string, font: PdfFont): number {
  const c = ch.codePointAt(0)!;
  const bold = font === "bold";
  if (c >= 0x20 && c <= 0x7e) return (bold ? BOLD_ASCII : REGULAR_ASCII)[c - 0x20]!;
  const extra = EXTRA_WIDTHS.get(ch);
  if (extra) return extra[bold ? 1 : 0];
  if (isWinAnsi(ch)) {
    // Letra con tilde, diéresis o similar: el ancho de la letra base
    const base = stripMarks(ch).charAt(0);
    const bc = base.codePointAt(0) ?? 0;
    if (bc >= 0x20 && bc <= 0x7e) return (bold ? BOLD_ASCII : REGULAR_ASCII)[bc - 0x20]!;
  }
  return charWidth("?", font);
}

/** Ancho de un texto en puntos. */
export function textWidth(text: string, font: PdfFont, size: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, font);
  return (w * size) / 1000;
}
