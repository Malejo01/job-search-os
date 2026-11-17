import { normalizeCvText } from "@job-search-os/pipeline";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import { minimalPdf } from "../../test/cv-pdf";
import {
  CV_PDF_MAX_PAGES,
  extractCvText,
  pdfPageText,
  readPdfText,
  type LoadPdfjs,
} from "./extract-text";

/**
 * R12-12 (D3): el PDF se lee en el navegador con pdfjs-dist. Acá corre en Node con el mismo build «legacy»
 * que usa la app (pdfjs arma un worker «falso» en el mismo proceso). CVs inventados de
 * `packages/pipeline/test/fixtures/cv-perfil/`.
 */
const FIXTURES = join(__dirname, "../../../../packages/pipeline/test/fixtures/cv-perfil");
const CVS = ["sin-experiencia", "con-experiencia", "cambio-de-carrera"] as const;
const cvText = (name: string): string => readFileSync(join(FIXTURES, `${name}.txt`), "utf8");

const loadInNode: LoadPdfjs = async () => import("pdfjs-dist/legacy/build/pdf.mjs");
const failToLoad: LoadPdfjs = async () => null;

const enc = new TextEncoder();
const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24];

/** DOCX mínimo (ZIP sin comprimir), un párrafo por renglón: el «DOCX equivalente» del PDF. */
function minimalDocx(lines: readonly string[]): Uint8Array {
  const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const parts = [
    {
      name: "[Content_Types].xml",
      text: '<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    },
    {
      name: "word/document.xml",
      text: `<?xml version="1.0"?><w:document><w:body>${lines
        .map((l) => `<w:p><w:r><w:t>${xmlEscape(l)}</w:t></w:r></w:p>`)
        .join("")}</w:body></w:document>`,
    },
  ];
  const body: number[] = [];
  const central: number[] = [];
  for (const p of parts) {
    const name = [...enc.encode(p.name)];
    const data = [...enc.encode(p.text)];
    const offset = body.length;
    const sizes = [...le32(0), ...le32(data.length), ...le32(data.length)];
    body.push(0x50, 0x4b, 0x03, 0x04, ...le16(20), ...le16(0), ...le16(0), ...le32(0));
    body.push(...sizes, ...le16(name.length), ...le16(0), ...name, ...data);
    central.push(0x50, 0x4b, 0x01, 0x02, ...le16(20), ...le16(20), ...le16(0), ...le16(0));
    central.push(...le32(0), ...sizes, ...le16(name.length), ...le16(0), ...le16(0));
    central.push(...le16(0), ...le16(0), ...le32(0), ...le32(offset), ...name);
  }
  const eocd = [0x50, 0x4b, 0x05, 0x06, ...le16(0), ...le16(0), ...le16(parts.length)];
  eocd.push(...le16(parts.length), ...le32(central.length), ...le32(body.length), ...le16(0));
  return new Uint8Array([...body, ...central, ...eocd]);
}

const file = (bytes: Uint8Array, name: string): File => new File([bytes.slice()], name);

/** El PDF no tiene renglones vacíos (pdfjs no los marca): se comparan los renglones con texto. */
const nonEmptyLines = (s: string): string[] => s.split("\n").filter((l) => l.trim() !== "");
/**
 * Un PDF corta los párrafos largos en varios renglones (el DOCX no): lo que tiene que coincidir es la
 * secuencia de palabras, con sus acentos y signos.
 */
const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

describe("extractCvText con PDF (R12-12)", () => {
  it.each(CVS)("PDF de texto → el mismo texto que el DOCX equivalente (%s)", async (name) => {
    const lines = cvText(name).split("\n");
    const pdf = await extractCvText(file(minimalPdf(lines), "cv.pdf"), loadInNode);
    const docx = await extractCvText(file(minimalDocx(lines), "cv.docx"));
    expect(docx.ok).toBe(true);
    expect(pdf.ok).toBe(true);
    if (!pdf.ok || !docx.ok) return;
    expect(words(pdf.text)).toEqual(words(docx.text));
    // Los títulos y los renglones cortos quedan iguales, renglón por renglón
    const pdfLines = new Set(nonEmptyLines(pdf.text));
    for (const l of nonEmptyLines(docx.text).filter((l) => l.length <= 80)) {
      expect(pdfLines.has(l), l).toBe(true);
    }
    // Acentos y eñes llegan bien (WinAnsi → Unicode)
    expect(pdf.text).toMatch(/[áéíóúñ]/);
    // El texto sale ya normalizado, igual que el del DOCX
    const again = normalizeCvText(pdf.text);
    expect(again.ok && again.value).toBe(pdf.text);
  });

  it("un CV de varias páginas se lee entero, en orden", async () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `Renglón ${i + 1} de un CV inventado largo`,
    );
    const r = await extractCvText(file(minimalPdf(lines), "cv.pdf"), loadInNode);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = nonEmptyLines(r.text);
    expect(got[0]).toBe("Renglón 1 de un CV inventado largo");
    expect(got.at(-1)).toBe("Renglón 120 de un CV inventado largo");
    expect(got).toHaveLength(120);
  });

  it("PDF escaneado (sin texto) → el mensaje de pegar el texto", async () => {
    const r = await extractCvText(file(minimalPdf(null), "cv.pdf"), loadInNode);
    expect(r).toEqual({ ok: false, problem: "unreadable" });
  });

  it("PDF con poco texto → el mismo mensaje (no se manda texto a medias)", async () => {
    const r = await extractCvText(file(minimalPdf(["Nombre Inventado"]), "cv.pdf"), loadInNode);
    expect(r).toEqual({ ok: false, problem: "unreadable" });
  });

  it("PDF dañado → no se lee", async () => {
    const broken = enc.encode("%PDF-1.4\nesto no es un PDF de verdad\n%%EOF\n");
    const r = await extractCvText(file(broken, "cv.pdf"), loadInNode);
    expect(r).toEqual({ ok: false, problem: "unreadable" });
  });

  it("un archivo .pdf que no es PDF no se le pasa a pdfjs", async () => {
    let loaded = false;
    const spy: LoadPdfjs = async () => {
      loaded = true;
      return loadInNode();
    };
    const r = await extractCvText(file(minimalDocx(["hola"]), "cv.pdf"), spy);
    expect(r).toEqual({ ok: false, problem: "unreadable" });
    expect(loaded).toBe(false);
  });

  it("si pdfjs no carga, el camino es pegar el texto", async () => {
    const lines = cvText("con-experiencia").split("\n");
    const r = await extractCvText(file(minimalPdf(lines), "cv.pdf"), failToLoad);
    expect(r).toEqual({ ok: false, problem: "pdf_paste" });
  });

  it("un PDF con más texto del máximo → demasiado largo", async () => {
    const line = "Experiencia inventada ".repeat(20);
    const r = await extractCvText(
      file(minimalPdf(Array.from({ length: 1400 }, () => line)), "cv.pdf"),
      loadInNode,
    );
    expect(r).toEqual({ ok: false, problem: "text_too_long" });
  });

  it("no lee más de CV_PDF_MAX_PAGES páginas", async () => {
    // 50 renglones por página: la página 31 empieza en el renglón 1501
    const lines = Array.from({ length: (CV_PDF_MAX_PAGES + 2) * 50 }, (_, i) => `R${i + 1}`);
    const r = await readPdfText(minimalPdf(lines), loadInNode);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain(`R${CV_PDF_MAX_PAGES * 50}`);
    expect(r.text).not.toContain(`R${CV_PDF_MAX_PAGES * 50 + 1}`);
  });
});

describe("pdfPageText", () => {
  it("une las piezas y corta renglón en cada fin de línea; ignora marcas sin texto", () => {
    expect(
      pdfPageText([
        { str: "Analista", hasEOL: false },
        { str: " ", hasEOL: false },
        { str: "contable", hasEOL: true },
        { hasEOL: false },
        { str: "Empresa C", hasEOL: true },
      ]),
    ).toBe("Analista contable\nEmpresa C\n");
  });
});

describe("carga de pdfjs y CSP", () => {
  const source = readFileSync(join(__dirname, "extract-text.ts"), "utf8");

  it("pdfjs se importa solo con import dinámico (el resto de la app no lo descarga)", () => {
    const staticImports = source.match(/^import\s+(?!type\b)[^;]*from\s+"pdfjs-dist[^"]*"/gm);
    expect(staticImports).toBeNull();
    expect(source).toContain('await import("pdfjs-dist/legacy/build/pdf.mjs")');
    // El worker sale del propio sitio (asset del bundler), no de un CDN
    expect(source).toMatch(/new URL\(\s*"pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs"/);
    expect(source).not.toMatch(/https?:\/\/[^"\s]*(cdn|unpkg|jsdelivr)/i);
  });

  it("el build de pdfjs que se usa no evalúa código (no hace falta `unsafe-eval`)", () => {
    const require = createRequire(__filename);
    const root = dirname(require.resolve("pdfjs-dist/package.json"));
    for (const f of ["legacy/build/pdf.mjs", "legacy/build/pdf.worker.min.mjs"]) {
      const js = readFileSync(join(root, f), "utf8");
      expect(js, f).not.toMatch(/[^\w.$]eval\(/);
      // Solo el respaldo de core-js para `globalThis`, que en un navegador nunca se ejecuta
      const fns = js.match(/[^\w.$]Function\([^)]*\)/g) ?? [];
      expect(
        fns.every((m) => /Function\(["']return this["']\)$/.test(m)),
        f,
      ).toBe(true);
    }
  });

  it("la CSP del sitio no se afloja: sin unsafe-eval ni orígenes nuevos", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const csp = rules.flatMap((r) =>
      r.headers.filter((h) => h.key.toLowerCase() === "content-security-policy"),
    );
    expect(csp.length).toBeGreaterThan(0);
    for (const h of csp) {
      expect(h.value).not.toContain("unsafe-eval");
      expect(h.value).not.toMatch(/https?:/);
    }
  });
});
