/**
 * Composición del PDF del CV (R33-08, ADR-049): parte el modelo del CV (`CvDocument`, el mismo del DOCX y de
 * la vista previa) en líneas y en páginas A4. Puro: sin I/O y sin librería de PDF; devuelve posiciones, no
 * bytes. Reglas:
 *  - A4 con márgenes de 2 cm (los mismos que el DOCX);
 *  - una viñeta o un párrafo nunca se corta entre dos páginas;
 *  - un título de sección no queda solo al pie: viaja con la primera entrada, y el cargo con su detalle y su
 *    primera viñeta;
 *  - las URL se ven completas como texto y llevan su caja de link (anotación en el PDF); un email, un
 *    `mailto:`;
 *  - todo el texto pasa por `normalizeForPdf` antes de medirse: lo que WinAnsi no tiene se informa.
 */
import type { CvBlock, CvDocument } from "./model";
import { normalizeForPdf, textWidth, type PdfFont, type PdfSubstitution } from "./pdf-text";

/** A4 en puntos (1 pt = 1/72 in). */
export const PDF_PAGE_WIDTH = 595.28;
export const PDF_PAGE_HEIGHT = 841.89;
/** 2 cm, igual que los márgenes del DOCX. */
export const PDF_MARGIN = 56.69;

export interface PdfLinkBox {
  /** Desde el borde izquierdo de la página. */
  x: number;
  width: number;
  /** `https://…` o `mailto:…`, solo ASCII visible. */
  url: string;
}

export interface PdfLine {
  x: number;
  /** Distancia desde el borde superior de la página hasta la línea de base. */
  baseline: number;
  text: string;
  font: PdfFont;
  size: number;
  links: PdfLinkBox[];
}

export interface PdfPageLayout {
  lines: PdfLine[];
}

export interface PdfLayout {
  pageWidth: number;
  pageHeight: number;
  margin: number;
  pages: PdfPageLayout[];
  /** Caracteres que no entran en WinAnsi y qué quedó en su lugar (vacío si no hubo). */
  substitutions: PdfSubstitution[];
}

interface Piece {
  text: string;
  url: string | null;
}

interface Unit {
  text: string;
  font: PdfFont;
  size: number;
  lead: number;
  before: number;
  after: number;
  /** Margen izquierdo extra respecto del margen de la página. */
  x: number;
  /** Prefijo de la primera línea (`• `); las siguientes se alinean debajo del texto. */
  prefix: string;
  keepNext: boolean;
}

interface Placed {
  unit: Unit;
  lines: { text: string; links: PdfLinkBox[]; x: number }[];
}

const URL_TOKEN_RE = /^https?:\/\/[\x21-\x7e]+$/i;
const EMAIL_TOKEN_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;

/** Parte el texto en palabras; las que son URL o email llevan su destino. */
function tokenize(text: string): Piece[] {
  const out: Piece[] = [];
  for (const word of text.split(/ +/)) {
    if (word === "") continue;
    const core = word.replace(TRAILING_PUNCT_RE, "");
    let url: string | null = null;
    if (URL_TOKEN_RE.test(core)) url = core;
    else if (EMAIL_TOKEN_RE.test(core) && /^[\x21-\x7e]+$/.test(core)) url = `mailto:${core}`;
    out.push({ text: word, url });
  }
  return out;
}

/** Parte una palabra más ancha que la línea en trozos que entran, por caracteres. */
function hardBreak(word: Piece, font: PdfFont, size: number, avail: number): Piece[] {
  const parts: Piece[] = [];
  let cur = "";
  for (const ch of word.text) {
    if (cur !== "" && textWidth(cur + ch, font, size) > avail) {
      parts.push({ text: cur, url: word.url });
      cur = "";
    }
    cur += ch;
  }
  if (cur !== "") parts.push({ text: cur, url: word.url });
  return parts;
}

/** Parte un texto en líneas que entran en el ancho. */
function wrap(
  unit: Unit,
  width: number,
  originX: number,
): { text: string; links: PdfLinkBox[]; x: number }[] {
  const { font, size, prefix } = unit;
  const prefixW = textWidth(prefix, font, size);
  // Las líneas de continuación se alinean debajo del texto: todas dejan el mismo ancho a las palabras
  const wordAvail = width - prefixW;
  const lines: Piece[][] = [];
  let line: Piece[] = [];
  const fits = (pieces: Piece[], first: boolean) =>
    textWidth((first ? prefix : "") + pieces.map((p) => p.text).join(" "), font, size) <=
    (first ? width : wordAvail);

  for (const word of tokenize(unit.text)) {
    const candidates =
      textWidth(word.text, font, size) > wordAvail
        ? hardBreak(word, font, size, wordAvail)
        : [word];
    candidates.forEach((w, idx) => {
      if (line.length > 0 && !fits([...line, w], lines.length === 0)) {
        lines.push(line);
        line = [];
      }
      line.push(w);
      // Un trozo duro ocupa su propia línea: nunca se le pega la palabra siguiente
      if (idx < candidates.length - 1) {
        lines.push(line);
        line = [];
      }
    });
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);

  return lines.map((pieces, i) => {
    const first = i === 0;
    const x = originX + (first ? 0 : prefixW);
    const text = (first ? prefix : "") + pieces.map((p) => p.text).join(" ");
    const links: PdfLinkBox[] = [];
    let consumed = first ? prefix : "";
    for (const p of pieces) {
      if (p.url) {
        const shown = p.text.replace(TRAILING_PUNCT_RE, "");
        links.push({
          x: x + textWidth(consumed, font, size),
          width: textWidth(shown === "" ? p.text : shown, font, size),
          url: p.url,
        });
      }
      consumed += p.text + " ";
    }
    return { text, links, x };
  });
}

function unitsOf(doc: CvDocument): Unit[] {
  const units: Unit[] = [];
  const body = {
    font: "regular" as PdfFont,
    size: 10.5,
    lead: 13.5,
    x: 0,
    prefix: "",
    after: 0,
  };
  if (doc.name) {
    units.push({
      text: doc.name,
      font: "bold",
      size: 18,
      lead: 22,
      before: 0,
      after: 2,
      x: 0,
      prefix: "",
      keepNext: true,
    });
  }
  if (doc.headline) {
    units.push({
      ...body,
      text: doc.headline,
      size: 11.5,
      lead: 15,
      before: 0,
      after: 2,
      keepNext: true,
    });
  }
  if (doc.contact.length > 0) {
    units.push({
      ...body,
      text: doc.contact.join(" | "),
      size: 10,
      lead: 13,
      before: 0,
      after: 4,
      keepNext: false,
    });
  }
  for (const section of doc.sections) {
    units.push({
      ...body,
      text: section.title,
      font: "bold",
      size: 12.5,
      lead: 16,
      before: 12,
      after: 3,
      keepNext: true,
    });
    for (const b of section.blocks) pushBlock(units, b, body);
  }
  return units;
}

function pushBlock(units: Unit[], b: CvBlock, body: Omit<Unit, "text" | "before" | "keepNext">) {
  const hasHeading = !!b.heading;
  if (b.heading) {
    units.push({
      ...body,
      text: b.heading,
      font: "bold",
      size: 11,
      lead: 14,
      before: 5,
      keepNext: !!b.detail || b.bullets.length > 0,
    });
  }
  if (b.detail) {
    units.push({
      ...body,
      text: b.detail,
      before: hasHeading ? 0 : 2,
      keepNext: b.bullets.length > 0,
    });
  }
  b.bullets.forEach((bullet, i) => {
    units.push({
      ...body,
      text: bullet,
      x: 4,
      prefix: "• ",
      before: i === 0 && !hasHeading && !b.detail ? 2 : 1,
      keepNext: false,
    });
  });
}

/** Compone el CV en páginas A4. Siempre devuelve al menos una página. */
export function layoutCvPdf(doc: CvDocument): PdfLayout {
  const subs = new Map<string, PdfSubstitution>();
  const note = (s: string): string => {
    const n = normalizeForPdf(s);
    for (const sub of n.substitutions) {
      const prev = subs.get(sub.codePoint);
      if (prev) prev.count += sub.count;
      else subs.set(sub.codePoint, { ...sub });
    }
    return n.text;
  };
  const units = unitsOf(doc).map((u) => ({ ...u, text: note(u.text), prefix: u.prefix }));

  const contentW = PDF_PAGE_WIDTH - 2 * PDF_MARGIN;
  const contentH = PDF_PAGE_HEIGHT - 2 * PDF_MARGIN;
  const placed: Placed[] = units.map((unit) => ({
    unit,
    lines: wrap(unit, contentW - unit.x, PDF_MARGIN + unit.x),
  }));

  // Cadenas: un tramo de unidades que viajan juntas (la última no tiene `keepNext`)
  const chains: Placed[][] = [];
  let cur: Placed[] = [];
  for (const p of placed) {
    cur.push(p);
    if (!p.unit.keepNext) {
      chains.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) chains.push(cur);

  const pages: PdfPageLayout[] = [{ lines: [] }];
  let cursor = 0;
  let atTop = true;
  const newPage = () => {
    pages.push({ lines: [] });
    cursor = 0;
    atTop = true;
  };
  const heightOf = (p: Placed, top: boolean) =>
    (top ? 0 : p.unit.before) + p.lines.length * p.unit.lead;
  const chainHeight = (chain: Placed[], top: boolean) =>
    chain.reduce((sum, p, i) => sum + heightOf(p, i === 0 ? top : false), 0);
  const emit = (p: Placed, from = 0, to = p.lines.length) => {
    if (!atTop) cursor += p.unit.before;
    atTop = false;
    const page = pages[pages.length - 1]!;
    for (const l of p.lines.slice(from, to)) {
      page.lines.push({
        x: l.x,
        baseline: PDF_MARGIN + cursor + (p.unit.lead - p.unit.size) / 2 + p.unit.size * 0.8,
        text: l.text,
        font: p.unit.font,
        size: p.unit.size,
        links: l.links,
      });
      cursor += p.unit.lead;
    }
  };
  const place = (p: Placed) => {
    if (heightOf(p, atTop) <= contentH - cursor) {
      emit(p);
    } else if (heightOf(p, true) <= contentH) {
      newPage();
      emit(p);
    } else {
      // Un bloque más alto que la página (no pasa con los topes del modelo): se parte por líneas
      let from = 0;
      while (from < p.lines.length) {
        const fit = Math.max(1, Math.floor((contentH - cursor) / p.unit.lead));
        emit(p, from, from + fit);
        from += fit;
        if (from < p.lines.length) newPage();
      }
    }
    cursor += p.unit.after;
  };

  for (const chain of chains) {
    if (chainHeight(chain, atTop) <= contentH - cursor) {
      chain.forEach(place);
    } else if (chainHeight(chain, true) <= contentH) {
      newPage();
      chain.forEach(place);
    } else {
      chain.forEach(place);
    }
  }

  return {
    pageWidth: PDF_PAGE_WIDTH,
    pageHeight: PDF_PAGE_HEIGHT,
    margin: PDF_MARGIN,
    pages,
    substitutions: [...subs.values()],
  };
}
