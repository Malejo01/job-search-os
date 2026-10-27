import { describe, expect, it } from "vitest";
import { docxContentTypesOk, sniffCvFile } from "../cv";
import { docxXmlToText } from "../cv/docx-text";
import { buildCvDocx, cvCrc32, cvFileName } from "./docx";
import { buildCvDocument, type CvSourceData } from "./model";

const data: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  headline: "Analista de datos",
  summary: "Analista con experiencia en reportes & tableros <clave>.",
  skills: [{ name: "SQL", category: "Datos" }],
  languages: [{ name: "Inglés", level: "B2" }],
  achievements: [],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: ["Armé reportes en SQL para 12 sucursales", "Bajé el cierre un 30%"],
    },
    {
      kind: "educacion",
      organization: "Universidad A",
      title: "Licenciatura en Estadística",
      startMonth: "2015-03",
      endMonth: "2019-12",
      bullets: [],
    },
  ],
};

const dec = new TextDecoder();

/** Lee las entradas de un ZIP `stored` por el directorio central y verifica el CRC-32 de cada una. */
function readZip(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const total = v.getUint16(eocd + 10, true);
  let pos = v.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  for (let i = 0; i < total; i++) {
    expect(v.getUint32(pos, true)).toBe(0x02014b50);
    expect(v.getUint16(pos + 10, true)).toBe(0); // sin comprimir
    const crc = v.getUint32(pos + 16, true);
    const size = v.getUint32(pos + 24, true);
    const nameLen = v.getUint16(pos + 28, true);
    const offset = v.getUint32(pos + 42, true);
    const name = dec.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    const dataStart = offset + 30 + v.getUint16(offset + 26, true) + v.getUint16(offset + 28, true);
    const content = bytes.subarray(dataStart, dataStart + size);
    expect(cvCrc32(content)).toBe(crc);
    out.set(name, dec.decode(content));
    pos += 46 + nameLen;
  }
  return out;
}

describe("cvCrc32", () => {
  it("coincide con el vector estándar", () => {
    expect(cvCrc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("buildCvDocx", () => {
  const doc = buildCvDocument(data, { lang: "es" });
  const bytes = buildCvDocx(doc);

  it("pasa sniffCvFile como docx", () => {
    expect(sniffCvFile(bytes)).toEqual({ ok: true, value: "docx" });
  });

  it("es un ZIP válido con las partes mínimas y CRC correctos", () => {
    const files = readZip(bytes);
    expect([...files.keys()].sort()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "word/_rels/document.xml.rels",
      "word/document.xml",
      "word/styles.xml",
    ]);
    expect(docxContentTypesOk(files.get("[Content_Types].xml")!)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("ida y vuelta: docxXmlToText recupera secciones, viñetas y datos", () => {
    const xml = readZip(bytes).get("word/document.xml")!;
    const r = docxXmlToText(xml);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines = r.value.split("\n");
    expect(lines[0]).toBe("Persona Ficticia");
    for (const h of ["Resumen", "Experiencia", "Educación", "Skills", "Idiomas"]) {
      expect(lines).toContain(h);
    }
    expect(lines).toContain("persona@example.com | Ciudad A");
    expect(lines).toContain("Empresa A | 03/2021 – Actual");
    expect(lines).toContain("• Armé reportes en SQL para 12 sucursales");
    expect(lines).toContain("• Bajé el cierre un 30%");
    expect(lines).toContain("Analista con experiencia en reportes & tableros <clave>.");
    expect(lines).toContain("Datos: SQL");
    expect(lines).toContain("Inglés: B2");
  });

  it("sin tablas, columnas, imágenes, encabezados ni pies", () => {
    const xml = readZip(bytes).get("word/document.xml")!;
    for (const tag of [
      "<w:tbl",
      "<w:cols",
      "<w:drawing",
      "<w:pict",
      "headerReference",
      "footerReference",
    ]) {
      expect(xml).not.toContain(tag);
    }
  });

  it("es determinista y quita caracteres inválidos de XML", () => {
    expect(buildCvDocx(doc)).toEqual(bytes);
    const dirty = buildCvDocument({ ...data, headline: "A\u0001B" }, { lang: "es" });
    const xml = readZip(buildCvDocx({ ...dirty, headline: "A\u0001B" })).get("word/document.xml")!;
    expect(xml).not.toContain("\u0001");
  });

  it("un CV vacío sigue siendo un DOCX legible por el sniff", () => {
    const empty = buildCvDocx(
      buildCvDocument(
        { displayName: "", skills: [], languages: [], achievements: [], history: [] },
        { lang: "es" },
      ),
    );
    expect(sniffCvFile(empty)).toEqual({ ok: true, value: "docx" });
  });
});

describe("cvFileName", () => {
  it("CV-Nombre-Apellido, ASCII", () => {
    expect(cvFileName({ name: "María José Pérez Núñez" })).toBe("CV-Maria-Nunez.docx");
    expect(cvFileName({ name: "Madonna" }, "pdf")).toBe("CV-Madonna.pdf");
    expect(cvFileName({ name: "" })).toBe("CV.docx");
  });
});
