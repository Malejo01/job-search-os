import { describe, expect, it } from "vitest";
import { CV_MAX_FILE_BYTES, CV_MAX_ZIP_ENTRIES } from "./limits";
import { docxContentTypesOk, sniffCvFile } from "./sniff";

const enc = new TextEncoder();

/** ZIP sin comprimir armado a mano: encabezados locales, directorio central y EOCD. */
function buildZip(names: string[]): Uint8Array {
  const parts: number[] = [];
  const central: number[] = [];
  const le = (n: number, bytes: number): number[] =>
    Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 0xff);
  for (const name of names) {
    const nameBytes = [...enc.encode(name)];
    const offset = parts.length;
    parts.push(0x50, 0x4b, 0x03, 0x04, ...le(20, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4));
    parts.push(...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(nameBytes.length, 2), ...le(0, 2));
    parts.push(...nameBytes);
    central.push(0x50, 0x4b, 0x01, 0x02, ...le(20, 2), ...le(20, 2), ...le(0, 2), ...le(0, 2));
    central.push(...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(0, 4));
    central.push(...le(nameBytes.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2));
    central.push(...le(0, 4), ...le(offset, 4), ...nameBytes);
  }
  const cdOffset = parts.length;
  const eocd = [
    0x50,
    0x4b,
    0x05,
    0x06,
    ...le(0, 2),
    ...le(0, 2),
    ...le(names.length, 2),
    ...le(names.length, 2),
    ...le(central.length, 4),
    ...le(cdOffset, 4),
    ...le(0, 2),
  ];
  return Uint8Array.from([...parts, ...central, ...eocd]);
}

const DOCX_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"];

describe("sniffCvFile", () => {
  it("reconoce un PDF por el encabezado", () => {
    const bytes = enc.encode("%PDF-1.7\n" + "x".repeat(200));
    expect(sniffCvFile(bytes)).toEqual({ ok: true, value: "pdf" });
  });

  it("acepta basura antes del encabezado dentro de 1024 bytes, no después", () => {
    const near = enc.encode("x".repeat(500) + "%PDF-1.4");
    expect(sniffCvFile(near)).toEqual({ ok: true, value: "pdf" });
    const far = enc.encode("x".repeat(1100) + "%PDF-1.4");
    expect(sniffCvFile(far)).toEqual({ ok: false, error: "unknown" });
  });

  it("reconoce un DOCX por el directorio central", () => {
    expect(sniffCvFile(buildZip(DOCX_ENTRIES))).toEqual({ ok: true, value: "docx" });
  });

  it("un .pdf que es un ZIP nunca da pdf", () => {
    const withDoc = sniffCvFile(buildZip(DOCX_ENTRIES));
    expect(withDoc.ok && withDoc.value).toBe("docx");
    const plain = sniffCvFile(buildZip(["a.txt", "b.txt"]));
    expect(plain).toEqual({ ok: false, error: "zip_not_docx" });
    // ZIP que además trae "%PDF-" a la vista
    const tricky = Uint8Array.from([...buildZip(["a.txt"]), ...enc.encode("%PDF-1.7")]);
    const r = sniffCvFile(tricky);
    expect(r.ok && r.value === "pdf").toBe(false);
  });

  it("rechaza DOCX con macros", () => {
    const r = sniffCvFile(buildZip([...DOCX_ENTRIES, "word/vbaProject.bin"]));
    expect(r).toEqual({ ok: false, error: "macro_enabled" });
    const nested = sniffCvFile(buildZip([...DOCX_ENTRIES, "word/VBAProject.data"]));
    expect(nested).toEqual({ ok: false, error: "macro_enabled" });
  });

  it("falta [Content_Types].xml o word/document.xml", () => {
    expect(sniffCvFile(buildZip(["word/document.xml"]))).toEqual({
      ok: false,
      error: "zip_not_docx",
    });
    expect(sniffCvFile(buildZip(["[Content_Types].xml"]))).toEqual({
      ok: false,
      error: "zip_not_docx",
    });
  });

  it("un ZIP truncado no es DOCX", () => {
    const zip = buildZip(DOCX_ENTRIES);
    expect(sniffCvFile(zip.subarray(0, zip.length - 30))).toEqual({
      ok: false,
      error: "zip_not_docx",
    });
  });

  it("rechaza ZIP con demasiadas entradas", () => {
    const many = Array.from({ length: CV_MAX_ZIP_ENTRIES + 1 }, (_, i) => `f${i}.xml`);
    expect(sniffCvFile(buildZip([...DOCX_ENTRIES, ...many]))).toEqual({
      ok: false,
      error: "zip_not_docx",
    });
  });

  it("rechaza OLE, vacío y demasiado grande", () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    expect(sniffCvFile(ole)).toEqual({ ok: false, error: "ole_legacy" });
    expect(sniffCvFile(new Uint8Array(0))).toEqual({ ok: false, error: "empty" });
    expect(sniffCvFile(new Uint8Array(CV_MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("texto plano o basura es unknown", () => {
    expect(sniffCvFile(enc.encode("hola, soy un txt"))).toEqual({ ok: false, error: "unknown" });
  });
});

describe("docxContentTypesOk", () => {
  it("acepta el tipo principal de Word", () => {
    const xml =
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>';
    expect(docxContentTypesOk(xml)).toEqual({ ok: true, value: true });
  });

  it("rechaza macroEnabled", () => {
    const xml =
      '<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>' +
      "wordprocessingml.document.main+xml";
    expect(docxContentTypesOk(xml)).toEqual({ ok: false, error: "macro_enabled" });
  });

  it("rechaza si falta el tipo", () => {
    expect(docxContentTypesOk("<Types></Types>")).toEqual({ ok: false, error: "zip_not_docx" });
  });
});
