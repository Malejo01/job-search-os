import { describe, expect, it } from "vitest";
import { CV_MAX_DOCX_INFLATED_BYTES, CV_MAX_ZIP_ENTRIES } from "../../cv/limits";
import { findZipEntry } from "./zip-entry";

type Part = { name: string; data: Uint8Array; method?: number; flags?: number; declared?: number };

const enc = new TextEncoder();
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number): number[] => [
  n & 0xff,
  (n >>> 8) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 24) & 0xff,
];

/** ZIP mínimo para probar el directorio central (CRC en 0: acá no se verifica). */
function zip(parts: Part[], opts: { total?: number } = {}): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  for (const p of parts) {
    const name = [...enc.encode(p.name)];
    const offset = chunks.length;
    const size = p.data.length;
    const uncompressed = p.declared ?? size;
    chunks.push(
      ...[0x50, 0x4b, 0x03, 0x04],
      ...le16(20),
      ...le16(p.flags ?? 0),
      ...le16(p.method ?? 0),
      ...le32(0),
      ...le32(0),
      ...le32(size),
      ...le32(uncompressed),
      ...le16(name.length),
      ...le16(0),
      ...name,
      ...p.data,
    );
    central.push(
      ...[0x50, 0x4b, 0x01, 0x02],
      ...le16(20),
      ...le16(20),
      ...le16(p.flags ?? 0),
      ...le16(p.method ?? 0),
      ...le32(0),
      ...le32(0),
      ...le32(size),
      ...le32(uncompressed),
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
  const cdStart = chunks.length;
  const total = opts.total ?? parts.length;
  const eocd = [
    ...[0x50, 0x4b, 0x05, 0x06],
    ...le16(0),
    ...le16(0),
    ...le16(total),
    ...le16(total),
    ...le32(central.length),
    ...le32(cdStart),
    ...le16(0),
  ];
  return new Uint8Array([...chunks, ...central, ...eocd]);
}

const xml = enc.encode("<w:document/>");

describe("findZipEntry", () => {
  it("ubica una entrada sin comprimir y devuelve el rango de sus bytes", () => {
    const bytes = zip([
      { name: "[Content_Types].xml", data: enc.encode("<Types/>") },
      { name: "word/document.xml", data: xml },
    ]);
    const r = findZipEntry(bytes, "word/document.xml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      method: 0,
      compressedSize: xml.length,
      uncompressedSize: xml.length,
    });
    expect(new TextDecoder().decode(bytes.subarray(r.value.start, r.value.end))).toBe(
      "<w:document/>",
    );
  });

  it("acepta deflate (método 8) sin descomprimir", () => {
    const bytes = zip([{ name: "word/document.xml", data: xml, method: 8, declared: 500 }]);
    const r = findZipEntry(bytes, "word/document.xml");
    expect(r.ok && r.value.method).toBe(8);
  });

  it("una entrada que no está es not_found", () => {
    expect(findZipEntry(zip([{ name: "a.xml", data: xml }]), "word/document.xml")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("falla cerrado: cifrada, método raro, bomba de descompresión y rango fuera del archivo", () => {
    const name = "word/document.xml";
    expect(findZipEntry(zip([{ name, data: xml, flags: 1 }]), name)).toEqual({
      ok: false,
      error: "encrypted",
    });
    expect(findZipEntry(zip([{ name, data: xml, method: 12 }]), name)).toEqual({
      ok: false,
      error: "unsupported_method",
    });
    expect(
      findZipEntry(
        zip([{ name, data: xml, method: 8, declared: CV_MAX_DOCX_INFLATED_BYTES + 1 }]),
        name,
      ),
    ).toEqual({ ok: false, error: "too_large" });
    // sin comprimir, el tamaño declarado tiene que coincidir con el real
    expect(findZipEntry(zip([{ name, data: xml, declared: 999 }]), name)).toEqual({
      ok: false,
      error: "corrupt",
    });
    const cut = zip([{ name, data: xml }]);
    // el directorio central apunta al encabezado local; si lo pisamos, es corrupto
    const broken = cut.slice();
    broken[0] = 0;
    expect(findZipEntry(broken, name)).toEqual({ ok: false, error: "corrupt" });
  });

  it("no es un ZIP, o declara demasiadas entradas", () => {
    expect(findZipEntry(new Uint8Array(0), "x")).toEqual({ ok: false, error: "not_zip" });
    expect(findZipEntry(enc.encode("%PDF-1.7 no es un zip, solo texto de relleno"), "x")).toEqual({
      ok: false,
      error: "not_zip",
    });
    const many = zip([{ name: "a", data: xml }], { total: CV_MAX_ZIP_ENTRIES + 1 });
    expect(findZipEntry(many, "a")).toEqual({ ok: false, error: "too_many_entries" });
  });

  it("un directorio central truncado es corrupto y no lanza", () => {
    const bytes = zip([{ name: "a", data: xml }], { total: 3 });
    expect(findZipEntry(bytes, "zzz")).toEqual({ ok: false, error: "corrupt" });
  });
});
