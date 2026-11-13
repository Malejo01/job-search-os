import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CV_MAX_DOCX_INFLATED_BYTES } from "../../cv/limits";
import { readDocxText, type InflateRaw } from "./docx-reader";

type Part = { name: string; text: string; deflate?: boolean };

const enc = new TextEncoder();
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

/** DOCX mínimo de prueba: ZIP con entradas sin comprimir o en deflate crudo (CRC en 0: no se verifica). */
function zip(parts: Part[]): Uint8Array {
  const body: number[] = [];
  const central: number[] = [];
  for (const p of parts) {
    const name = [...enc.encode(p.name)];
    const raw = enc.encode(p.text);
    const data = p.deflate ? new Uint8Array(deflateRawSync(raw)) : raw;
    const method = p.deflate ? 8 : 0;
    const offset = body.length;
    body.push(
      ...[0x50, 0x4b, 0x03, 0x04],
      ...le16(20),
      ...le16(0),
      ...le16(method),
      ...le32(0),
      ...le32(0),
      ...le32(data.length),
      ...le32(raw.length),
      ...le16(name.length),
      ...le16(0),
      ...name,
      ...data,
    );
    central.push(
      ...[0x50, 0x4b, 0x01, 0x02],
      ...le16(20),
      ...le16(20),
      ...le16(0),
      ...le16(method),
      ...le32(0),
      ...le32(0),
      ...le32(data.length),
      ...le32(raw.length),
      ...le16(name.length),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le16(0),
      ...le32(0),
      ...le32(offset),
      ...name,
    );
  }
  const eocd = [
    ...[0x50, 0x4b, 0x05, 0x06],
    ...le16(0),
    ...le16(0),
    ...le16(parts.length),
    ...le16(parts.length),
    ...le32(central.length),
    ...le32(body.length),
    ...le16(0),
  ];
  return new Uint8Array([...body, ...central, ...eocd]);
}

const inflate: InflateRaw = async (data, max) => {
  const out = new Uint8Array(inflateRawSync(data));
  return out.length > max ? null : out;
};

const TYPES =
  '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const DOC = (inner: string): string =>
  `<?xml version="1.0"?><w:document><w:body>${inner}</w:body></w:document>`;
const P = (t: string): string => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

const docx = (documentXml: string, over: Partial<Part> = {}, types = TYPES): Uint8Array =>
  zip([
    { name: "[Content_Types].xml", text: types, deflate: true },
    { name: "word/document.xml", text: documentXml, deflate: true, ...over },
  ]);

describe("readDocxText", () => {
  it("lee el texto de un DOCX comprimido y de uno sin comprimir", async () => {
    const xml = DOC(P("Analista de datos") + P("Empresa Ficticia &amp; Asociados"));
    for (const deflate of [true, false]) {
      const r = await readDocxText(docx(xml, { deflate }), inflate);
      expect(r).toEqual({ ok: true, value: "Analista de datos\nEmpresa Ficticia & Asociados\n" });
    }
  });

  it("un DOCX sin texto (solo imágenes) es 'unreadable': ofrece seguir con la charla", async () => {
    expect(await readDocxText(docx(DOC("<w:p></w:p>")), inflate)).toEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("macros: por el nombre de la parte o por el tipo declarado", async () => {
    const withVba = zip([
      { name: "[Content_Types].xml", text: TYPES },
      { name: "word/document.xml", text: DOC(P("x")) },
      { name: "word/vbaProject.bin", text: "x" },
    ]);
    expect(await readDocxText(withVba, inflate)).toEqual({ ok: false, error: "macro_enabled" });
    const macroTypes = TYPES.replace("document.main+xml", "document.macroEnabled.main+xml");
    expect(await readDocxText(docx(DOC(P("x")), {}, macroTypes), inflate)).toEqual({
      ok: false,
      error: "macro_enabled",
    });
  });

  it("falla cerrado: DOCTYPE, ZIP que no es un DOCX, PDF disfrazado, OLE viejo y vacío", async () => {
    const xxe = '<!DOCTYPE d [<!ENTITY e "x">]>' + DOC(P("&e;"));
    expect(await readDocxText(docx(xxe), inflate)).toEqual({ ok: false, error: "not_docx" });
    expect(await readDocxText(zip([{ name: "otra/cosa.txt", text: "hola" }]), inflate)).toEqual({
      ok: false,
      error: "not_docx",
    });
    expect(await readDocxText(enc.encode("%PDF-1.7\nrelleno"), inflate)).toEqual({
      ok: false,
      error: "pdf_paste",
    });
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    expect(await readDocxText(ole, inflate)).toEqual({ ok: false, error: "legacy_doc" });
    expect(await readDocxText(new Uint8Array(0), inflate)).toEqual({ ok: false, error: "empty" });
    expect(await readDocxText(enc.encode("texto cualquiera sin forma"), inflate)).toEqual({
      ok: false,
      error: "not_docx",
    });
  });

  it("bomba de descompresión: si al inflar pasa el tope, no se entrega nada", async () => {
    const big = DOC(P("a".repeat(CV_MAX_DOCX_INFLATED_BYTES)));
    const r = await readDocxText(docx(big), inflate);
    expect(r.ok).toBe(false);
  });

  it("un inflador que falla (devuelve null) es 'not_docx', sin lanzar", async () => {
    expect(await readDocxText(docx(DOC(P("x"))), async () => null)).toEqual({
      ok: false,
      error: "not_docx",
    });
  });
});
