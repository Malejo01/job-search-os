/**
 * PDF mínimo de prueba (R12-12), armado a mano y sin librerías: una línea de texto por renglón, fuente
 * Helvetica con WinAnsiEncoding (acentos y eñes del español), párrafos cortados a 90 caracteres y
 * páginas de 50 renglones. Con `lines = null` arma un PDF «escaneado»: una página con un dibujo y sin
 * texto. Solo para tests; los textos son inventados.
 */

/** WinAnsi fuera de Latin-1: lo que suele traer un CV. Lo demás se escribe como su código Latin-1. */
const WIN_ANSI: Record<string, number> = {
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
};

function winAnsiBytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const code = WIN_ANSI[ch] ?? ch.codePointAt(0)!;
    if (code > 0xff) throw new Error(`carácter fuera de WinAnsi: ${ch}`);
    // Escape de cadenas literales de PDF
    if (ch === "\\" || ch === "(" || ch === ")") out.push(0x5c);
    out.push(code);
  }
  return out;
}

const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

const LINES_PER_PAGE = 50;
/** Ancho de renglón: a 10 pt, unos 90 caracteres entran en una página A4 con márgenes. */
const WRAP = 90;

/** Corta un párrafo largo en renglones, por palabras, como lo haría un procesador de texto. */
function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    if (current && current.length + 1 + word.length > WRAP) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out;
}

export function minimalPdf(lines: readonly string[] | null): Uint8Array {
  const pages: number[][] = [];
  if (lines === null) {
    // Un rectángulo gris: hay contenido, pero no hay texto (como una imagen escaneada)
    pages.push(ascii("0.5 g 40 400 500 300 re f\n"));
  } else {
    lines = lines.flatMap(wrap);
    for (let i = 0; i < Math.max(lines.length, 1); i += LINES_PER_PAGE) {
      const content = ascii("BT /F1 10 Tf 14 TL 40 800 Td\n");
      for (const line of lines.slice(i, i + LINES_PER_PAGE)) {
        content.push(...ascii("("), ...winAnsiBytes(line), ...ascii(") Tj T*\n"));
      }
      content.push(...ascii("ET\n"));
      pages.push(content);
    }
  }

  // Objetos: 1 catálogo, 2 páginas, 3 fuente, y por página: la página y su contenido
  const objects: number[][] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objects.push(ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(ascii(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  objects.push(
    ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"),
  );
  pages.forEach((content, i) => {
    const pageObj = 4 + i * 2;
    objects.push(
      ascii(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj + 1} 0 R >>`,
      ),
    );
    objects.push([
      ...ascii(`<< /Length ${content.length} >>\nstream\n`),
      ...content,
      ...ascii("endstream"),
    ]);
  });

  const out: number[] = ascii("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out.push(...ascii(`${i + 1} 0 obj\n`), ...body, ...ascii("\nendobj\n"));
  });
  const xref = out.length;
  out.push(...ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const o of offsets) out.push(...ascii(`${String(o).padStart(10, "0")} 00000 n \n`));
  out.push(
    ...ascii(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`),
  );
  return new Uint8Array(out);
}
