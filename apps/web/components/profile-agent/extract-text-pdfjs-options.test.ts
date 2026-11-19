import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { minimalPdf } from "../../test/cv-pdf";
import { readPdfText, type Pdfjs } from "./extract-text";

/**
 * Un PDF hostil no tiene que poder ejecutar código en el navegador. pdfjs 6.x ya no compila las funciones del
 * PDF con `new Function` y quitó la opción `isEvalSupported`: pasarla no compila (los tipos no la conocen). Lo
 * que protege es que el build instalado no use eval; si una versión futura lo vuelve a usar, este test falla y
 * hay que pasar `isEvalSupported: false` al abrir el documento.
 */
describe("pdfjs sin eval", () => {
  const require = createRequire(import.meta.url);
  const buildDir = join(dirname(require.resolve("pdfjs-dist/package.json")), "legacy", "build");

  it("el build legacy instalado no usa new Function, eval ni la opción isEvalSupported", () => {
    const files = readdirSync(buildDir).filter((f) => f.endsWith(".mjs"));
    expect(files).toContain("pdf.worker.min.mjs");
    const offenders = files.filter((f) =>
      /new Function\(|(^|[^.\w])eval\(|isEvalSupported/.test(readFileSync(join(buildDir, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

describe("readPdfText: opciones de pdfjs", () => {
  async function capturedParams(): Promise<Record<string, unknown>> {
    let params: Record<string, unknown> = {};
    const fake = {
      getDocument: (p: Record<string, unknown>) => {
        params = p;
        return {
          promise: Promise.reject(new Error("sin documento")),
          destroy: async () => undefined,
        };
      },
    } as unknown as Pdfjs;
    await readPdfText(minimalPdf(["Texto de prueba"]), async () => fake);
    return params;
  }

  it("abre el documento solo para leer texto", async () => {
    expect(await capturedParams()).toMatchObject({
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableAutoFetch: true,
      disableStream: true,
    });
  });
});
