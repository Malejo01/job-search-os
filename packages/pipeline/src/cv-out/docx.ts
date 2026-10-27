/**
 * DOCX del CV sin dependencias (C-25 / 100 §3.2): un ZIP sin comprimir (`stored`) con CRC-32 propio y el
 * WordprocessingML mínimo. Una columna, sin tablas, imágenes, encabezados ni pies; títulos estándar y
 * viñetas como párrafos con «•». Determinista: misma entrada, mismos bytes.
 */
import { foldCvText } from "./verify";
import type { CvDocument } from "./model";

const enc = new TextEncoder();

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (IEEE 802.3), el del ZIP. */
export function cvCrc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01, para que el archivo sea determinista
const FLAG_UTF8 = 0x0800;

class Writer {
  private chunks: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.chunks.push(b);
    this.length += b.length;
  }
  u16(n: number): void {
    this.push(Uint8Array.of(n & 0xff, (n >>> 8) & 0xff));
  }
  u32(n: number): void {
    this.push(Uint8Array.of(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff));
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** ZIP con las entradas sin comprimir. */
function zipStored(files: ReadonlyArray<{ name: string; data: Uint8Array }>): Uint8Array {
  const w = new Writer();
  const central = new Writer();
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = cvCrc32(f.data);
    const offset = w.length;
    w.u32(0x04034b50);
    w.u16(20);
    w.u16(FLAG_UTF8);
    w.u16(0);
    w.u16(DOS_TIME);
    w.u16(DOS_DATE);
    w.u32(crc);
    w.u32(f.data.length);
    w.u32(f.data.length);
    w.u16(name.length);
    w.u16(0);
    w.push(name);
    w.push(f.data);

    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(FLAG_UTF8);
    central.u16(0);
    central.u16(DOS_TIME);
    central.u16(DOS_DATE);
    central.u32(crc);
    central.u32(f.data.length);
    central.u32(f.data.length);
    central.u16(name.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(offset);
    central.push(name);
  }
  const cdOffset = w.length;
  const cd = central.bytes();
  w.push(cd);
  w.u32(0x06054b50);
  w.u16(0);
  w.u16(0);
  w.u16(files.length);
  w.u16(files.length);
  w.u32(cd.length);
  w.u32(cdOffset);
  w.u16(0);
  return w.bytes();
}

const XML_INVALID_RE = new RegExp(
  // eslint-disable-next-line no-control-regex
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]",
  "g",
);

/** Escapa XML y saca los caracteres que WordprocessingML no admite. */
function esc(s: string): string {
  return s
    .replace(XML_INVALID_RE, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function para(style: string, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

function documentXml(doc: CvDocument): string {
  const body: string[] = [];
  if (doc.name) body.push(para("Title", doc.name));
  if (doc.headline) body.push(para("Normal", doc.headline));
  if (doc.contact.length > 0) body.push(para("Normal", doc.contact.join(" | ")));
  for (const s of doc.sections) {
    body.push(para("Heading1", s.title));
    for (const b of s.blocks) {
      if (b.heading) body.push(para("Entry", b.heading));
      if (b.detail) body.push(para("Normal", b.detail));
      for (const bullet of b.bullets) body.push(para("Bullet", `• ${bullet}`));
    }
  }
  if (body.length === 0) body.push(para("Normal", ""));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    body.join("") +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>` +
    `</w:body></w:document>`
  );
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL}/styles" Target="styles.xml"/></Relationships>`;

function style(id: string, name: string, rpr: string, ppr: string): string {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
}

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W_NS}">` +
  `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
  style(
    "Title",
    "Title",
    `<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/>`,
    `<w:spacing w:after="80"/>`,
  ) +
  style(
    "Heading1",
    "heading 1",
    `<w:b/><w:sz w:val="26"/><w:szCs w:val="26"/>`,
    `<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/>`,
  ) +
  style("Entry", "Entry", `<w:b/>`, `<w:keepNext/><w:spacing w:before="80" w:after="0"/>`) +
  style("Bullet", "Bullet", ``, `<w:ind w:left="360" w:hanging="220"/>`) +
  `</w:styles>`;

/** Bytes del DOCX del CV. Pasa `sniffCvFile` como `docx` y `docxXmlToText` recupera el texto. */
export function buildCvDocx(doc: CvDocument): Uint8Array {
  return zipStored([
    { name: "[Content_Types].xml", data: enc.encode(CONTENT_TYPES) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "word/document.xml", data: enc.encode(documentXml(doc)) },
    { name: "word/_rels/document.xml.rels", data: enc.encode(DOCUMENT_RELS) },
    { name: "word/styles.xml", data: enc.encode(STYLES) },
  ]);
}

/** `CV-Nombre-Apellido.docx`, solo ASCII. Sin nombre: `CV.docx`. */
export function cvFileName(doc: Pick<CvDocument, "name">, ext: "docx" | "pdf" = "docx"): string {
  const words = foldCvText(doc.name)
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ""))
    .filter((w) => w !== "");
  if (words.length === 0) return `CV.${ext}`;
  const pick = words.length > 1 ? [words[0]!, words[words.length - 1]!] : [words[0]!];
  return `CV-${pick.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-")}.${ext}`;
}
