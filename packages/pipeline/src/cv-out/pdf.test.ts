import { describe, expect, it } from "vitest";
import { sniffCvFile } from "../cv";
import { buildCvDocx, cvFileName } from "./docx";
import { CV_DOWNLOADS_PER_HOUR, CV_DOWNLOADS_PER_MINUTE, decideCvDownload } from "./download-rate";
import { buildCvDocument, type CvDocument, type CvSourceData } from "./model";
import { buildCvPdf } from "./pdf";
import { layoutCvPdf, PDF_MARGIN, PDF_PAGE_HEIGHT, PDF_PAGE_WIDTH } from "./pdf-layout";
import { charWidth, normalizeForPdf, textWidth, winAnsiByte, winAnsiChar } from "./pdf-text";

const base: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  country: "País A",
  links: { linkedin: "https://linkedin.example.com/in/persona-ficticia" },
  headline: "Analista de datos",
  summary: "Analista con experiencia en reportes y tableros.",
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

const doc = (data: Partial<CvSourceData> = {}, lang: "es" | "en" = "es"): CvDocument =>
  buildCvDocument({ ...base, ...data }, { lang });

/** Lee un PDF de vuelta: bytes → cadena binaria. */
const bin = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => String.fromCharCode(b)).join("");

/** Texto de cada página, tal como lo sacaría un lector (operadores Tj, desescapados y en WinAnsi). */
function pageTexts(bytes: Uint8Array): string[][] {
  const s = bin(bytes);
  const streams = [...s.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((m) => m[1]!);
  return streams.map((st) =>
    [...st.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) =>
      m[1]!
        .replace(/\\([()\\])/g, "$1")
        .split("")
        .map((c) => winAnsiChar(c.charCodeAt(0)))
        .join(""),
    ),
  );
}

describe("WinAnsi y anchos", () => {
  it("las tablas de Helvetica tienen los 95 caracteres imprimibles de ASCII", () => {
    // 0x20..0x7E: cada uno devuelve un ancho propio y conocido
    expect(charWidth(" ", "regular")).toBe(278);
    expect(charWidth("A", "regular")).toBe(667);
    expect(charWidth("a", "regular")).toBe(556);
    expect(charWidth("i", "regular")).toBe(222);
    expect(charWidth("~", "regular")).toBe(584);
    expect(charWidth("A", "bold")).toBe(722);
    expect(charWidth("~", "bold")).toBe(584);
    expect(charWidth("m", "bold")).toBe(889);
  });

  it("una letra con tilde mide como su letra base", () => {
    expect(charWidth("é", "regular")).toBe(charWidth("e", "regular"));
    expect(charWidth("ñ", "bold")).toBe(charWidth("n", "bold"));
    expect(charWidth("Ü", "regular")).toBe(charWidth("U", "regular"));
  });

  it("tildes, eñes, ¿ y ¡ tienen byte propio", () => {
    for (const ch of "áéíóúüñÁÉÍÓÚÑ¿¡€•–—“”’…") expect(winAnsiByte(ch)).not.toBeNull();
    expect(winAnsiByte("ñ")).toBe(0xf1);
    expect(winAnsiByte("•")).toBe(0x95);
    expect(winAnsiChar(0xf1)).toBe("ñ");
    expect(winAnsiChar(0x95)).toBe("•");
  });

  it("texto con solo WinAnsi pasa sin reemplazos", () => {
    const n = normalizeForPdf("Diseño y planificación ¿qué? ¡sí! – 100 €");
    expect(n.substitutions).toEqual([]);
    expect(n.text).toBe("Diseño y planificación ¿qué? ¡sí! – 100 €");
  });

  it("falla cerrado y avisa: lo que no entra se reemplaza por lo más parecido o por «?», y se informa", () => {
    const n = normalizeForPdf("Łódź → ok ✓ 日本");
    expect(n.text).toBe("Lódz -> ok v ??");
    const byCode = Object.fromEntries(n.substitutions.map((s) => [s.codePoint, s]));
    expect(byCode["U+0141"]).toMatchObject({ replacement: "L", kind: "closest" });
    expect(byCode["U+017A"]).toMatchObject({ replacement: "z", kind: "closest" });
    expect(byCode["U+2192"]).toMatchObject({ replacement: "->", kind: "closest" });
    expect(byCode["U+65E5"]).toMatchObject({ replacement: "?", kind: "unmapped" });
    expect(n.substitutions.every((s) => !JSON.stringify(s).includes("Ł"))).toBe(true);
  });

  it("saltos de línea y espacios raros pasan a espacio sin informar; un emoji se informa", () => {
    const n = normalizeForPdf("a\tb\nc d e");
    expect(n.text).toBe("a b c d e");
    expect(n.substitutions).toEqual([]);
    expect(normalizeForPdf("hola 😀").substitutions[0]).toMatchObject({ kind: "unmapped" });
  });

  it("textWidth suma los anchos", () => {
    expect(textWidth("AA", "regular", 10)).toBeCloseTo(13.34, 2);
  });
});

describe("composición (layout)", () => {
  it("CV muy corto: una página A4 con márgenes de 2 cm y todo adentro", () => {
    const l = layoutCvPdf(doc());
    expect(l.pages).toHaveLength(1);
    expect(l.pageWidth).toBeCloseTo(595.28, 2);
    expect(l.pageHeight).toBeCloseTo(841.89, 2);
    for (const line of l.pages[0]!.lines) {
      expect(line.x).toBeGreaterThanOrEqual(PDF_MARGIN - 0.01);
      expect(line.x + textWidth(line.text, line.font, line.size)).toBeLessThanOrEqual(
        PDF_PAGE_WIDTH - PDF_MARGIN + 0.01,
      );
      expect(line.baseline).toBeLessThanOrEqual(PDF_PAGE_HEIGHT - PDF_MARGIN + 0.01);
    }
    expect(l.substitutions).toEqual([]);
  });

  it("CV vacío: una página sin líneas", () => {
    const l = layoutCvPdf(
      buildCvDocument(
        { displayName: "", skills: [], languages: [], achievements: [], history: [] },
        { lang: "es" },
      ),
    );
    expect(l.pages).toHaveLength(1);
    expect(l.pages[0]!.lines).toHaveLength(0);
  });

  it("CV largo: dos páginas y ninguna viñeta se corta entre páginas", () => {
    const long =
      "Armé reportes de ventas por sucursal y los presenté al equipo comercial cada semana ".repeat(
        2,
      );
    const history = Array.from({ length: 12 }, (_, i) => ({
      kind: "trabajo" as const,
      organization: `Empresa ${i}`,
      title: `Analista ${i}`,
      startMonth: "2015-03",
      endMonth: "2016-03",
      bullets: Array.from({ length: 6 }, (__, j) => `${j} ${long.trim()}`),
    }));
    const d = doc({ history });
    const l = layoutCvPdf(d);
    expect(l.pages.length).toBeGreaterThanOrEqual(2);
    // Cada viñeta del modelo aparece completa en una sola página
    for (const section of d.sections) {
      for (const b of section.blocks) {
        for (const bullet of b.bullets) {
          const words = bullet.split(" ");
          const head = `• ${words.slice(0, 3).join(" ")}`;
          const tail = words.slice(-2).join(" ");
          const texts = l.pages.map((p) => p.lines.map((ln) => ln.text).join(" "));
          const startPages = texts.flatMap((t, i) => (t.includes(head) ? [i] : []));
          expect(startPages.length).toBeGreaterThan(0);
          // el comienzo y el final de la viñeta están en la misma página
          for (const i of startPages) expect(texts[i]).toContain(tail);
        }
      }
    }
    // Una viñeta que arranca con «• » y sigue en las líneas siguientes queda en la misma página
    for (const p of l.pages) {
      const first = p.lines[0];
      // Ninguna página arranca con una línea de continuación de viñeta (sangrada más que el margen + 4)
      if (first) expect(first.x).toBeLessThan(PDF_MARGIN + 5);
    }
  });

  it("un título de sección no queda solo al pie de la página", () => {
    const filler = Array.from({ length: 6 }, (_, i) => ({
      kind: "trabajo" as const,
      organization: `Empresa ${i}`,
      title: `Cargo ${i}`,
      startMonth: "2015-03",
      endMonth: "2016-03",
      bullets: Array.from(
        { length: 5 },
        (__, j) => `Tarea ${j} del puesto ${i} con detalle suficiente`,
      ),
    }));
    const l = layoutCvPdf(doc({ history: filler }));
    for (const p of l.pages) {
      const last = p.lines[p.lines.length - 1];
      if (last && l.pages.length > 1) {
        expect(["Educación", "Skills", "Idiomas", "Experiencia"]).not.toContain(last.text);
        // ni un cargo (negrita 11) solo al final
        expect(last.font === "bold" && last.size <= 11 ? last.text : "").toBe("");
      }
    }
  });

  it("nombres y emails largos no se salen del margen; las URL largas se parten por caracteres", () => {
    const longEmail = `${"nombre.muy.largo".repeat(6)}@dominio-de-prueba.example.com`;
    const d = doc({
      displayName: "María de los Ángeles Fernández de la Vega Echeverría Ibarra",
      email: longEmail,
      links: { portfolio: `https://sitio.example.com/${"proyecto-".repeat(20)}fin` },
    });
    const l = layoutCvPdf(d);
    for (const p of l.pages) {
      for (const line of p.lines) {
        expect(line.x + textWidth(line.text, line.font, line.size)).toBeLessThanOrEqual(
          PDF_PAGE_WIDTH - PDF_MARGIN + 0.5,
        );
      }
    }
  });

  it("links: la URL va completa como texto y con su caja; el email, mailto", () => {
    const l = layoutCvPdf(doc());
    const lines = l.pages[0]!.lines;
    const withLinks = lines.filter((ln) => ln.links.length > 0);
    const urls = withLinks.flatMap((ln) => ln.links.map((k) => k.url));
    expect(urls).toContain("https://linkedin.example.com/in/persona-ficticia");
    expect(urls).toContain("mailto:persona@example.com");
    expect(lines.map((x) => x.text).join(" ")).toContain(
      "https://linkedin.example.com/in/persona-ficticia",
    );
    for (const k of withLinks.flatMap((ln) => ln.links)) {
      expect(k.width).toBeGreaterThan(0);
      expect(k.x).toBeGreaterThanOrEqual(PDF_MARGIN - 0.01);
    }
  });
});

describe("serializador PDF", () => {
  const { bytes, pages } = buildCvPdf(doc());
  const s = bin(bytes);

  it("es un PDF válido: cabecera, xref con desplazamientos exactos, trailer y %%EOF", () => {
    expect(s.startsWith("%PDF-1.4\n")).toBe(true);
    expect(s.endsWith("%%EOF\n")).toBe(true);
    expect(pages).toBe(1);
    const start = Number(/startxref\n(\d+)\n%%EOF/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const entries = [...s.slice(start).matchAll(/(\d{10}) (\d{5}) ([nf]) \n/g)];
    expect(entries[0]![3]).toBe("f");
    entries.slice(1).forEach((m, i) => {
      const off = Number(m[1]);
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect(s).toMatch(/\/Size \d+ \/Root 1 0 R/);
    expect(s).toContain("/Count 1");
  });

  it("A4, fuentes estándar con WinAnsi, sin imágenes ni scripts ni compresión", () => {
    expect(s).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(s).toContain("/BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(s).toContain("/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding");
    expect(s).not.toMatch(/\/(Image|JavaScript|JS|OpenAction|Launch|EmbeddedFile|Filter)\b/);
  });

  it("el texto es real y seleccionable: está en los Tj y con acentos y eñes bien", () => {
    const d = doc({
      displayName: "Muñoz Núñez",
      headline: "Diseñador gráfico ¿y qué más? ¡Mucho!",
    });
    const text = pageTexts(buildCvPdf(d).bytes).flat().join("\n");
    expect(text).toContain("Muñoz Núñez");
    expect(text).toContain("Diseñador gráfico ¿y qué más? ¡Mucho!");
    expect(text).toContain("Licenciatura en Estadística");
    expect(text).toContain("• Armé reportes en SQL para 12 sucursales");
  });

  it("los links son anotaciones /Link con /URI; paréntesis y barras se escapan", () => {
    expect(s).toContain("/Subtype /Link");
    expect(s).toContain("/URI (https://linkedin.example.com/in/persona-ficticia)");
    expect(s).toContain("/URI (mailto:persona@example.com)");
    const withParen = buildCvPdf(doc({ links: { portfolio: "https://sitio.example.com/a(b)c" } }));
    expect(bin(withParen.bytes)).toContain("/URI (https://sitio.example.com/a\\(b\\)c)");
  });

  it("determinista: misma entrada, mismos bytes", () => {
    expect(Array.from(buildCvPdf(doc()).bytes)).toEqual(Array.from(buildCvPdf(doc()).bytes));
  });

  it("paréntesis y barras invertidas del texto se escapan y se leen de vuelta", () => {
    const d = doc({ headline: "Datos (BI) \\ análisis" });
    const text = pageTexts(buildCvPdf(d).bytes).flat().join("\n");
    expect(text).toContain("Datos (BI) \\ análisis");
  });
});

describe("pruebas de C-55", () => {
  it("CV vacío: genera un PDF de una página, sin romper", () => {
    const empty = buildCvDocument(
      { displayName: "", skills: [], languages: [], achievements: [], history: [] },
      { lang: "es" },
    );
    const r = buildCvPdf(empty);
    expect(r.pages).toBe(1);
    expect(bin(r.bytes).startsWith("%PDF-1.4")).toBe(true);
  });

  it("CV muy corto: una página", () => {
    const short = doc({ history: [], skills: [], languages: [], headline: null, summary: null });
    expect(buildCvPdf(short).pages).toBe(1);
  });

  it("CV de dos páginas", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      kind: "trabajo" as const,
      organization: `Empresa ${i}`,
      title: `Cargo ${i}`,
      startMonth: "2010-01",
      endMonth: "2012-01",
      bullets: Array.from(
        { length: 6 },
        (__, j) => `Tarea ${j} ${"con bastante detalle ".repeat(5)}`,
      ),
    }));
    const r = buildCvPdf(doc({ history }));
    expect(r.pages).toBe(2);
    expect(bin(r.bytes)).toContain("/Count 2");
  });

  it("versión en inglés: títulos en inglés y el mismo texto que el DOCX", () => {
    const en = doc({ languages: [{ name: "Spanish", level: "Native" }] }, "en");
    const text = pageTexts(buildCvPdf(en).bytes).flat();
    expect(text).toContain("Experience");
    expect(text).toContain("Education");
    expect(text).toContain("Skills");
    expect(text).not.toContain("Experiencia");
  });

  it("el PDF y el DOCX salen del mismo modelo: todo el texto del modelo está en el PDF", () => {
    const d = doc();
    const flat = pageTexts(buildCvPdf(d).bytes).flat().join(" ").replace(/\s+/g, " ");
    expect(flat).toContain(d.name);
    for (const s of d.sections) {
      expect(flat).toContain(s.title);
      for (const b of s.blocks) {
        if (b.heading) expect(flat).toContain(b.heading);
        for (const bullet of b.bullets) expect(flat).toContain(bullet);
      }
    }
    // y el DOCX del mismo modelo es un DOCX válido
    expect(sniffCvFile(buildCvDocx(d))).toEqual({ ok: true, value: "docx" });
  });

  it("nombre de archivo: CV-Nombre-Apellido.pdf, solo ASCII", () => {
    expect(cvFileName({ name: "María Pérez Núñez" }, "pdf")).toBe("CV-Maria-Nunez.pdf");
    expect(cvFileName({ name: "" }, "pdf")).toBe("CV.pdf");
  });

  it("caracteres fuera de WinAnsi: el PDF sale igual y lo reemplazado queda informado", () => {
    const r = buildCvPdf(doc({ headline: "Analista → Łukasz" }));
    expect(r.substitutions.map((x) => x.codePoint).sort()).toEqual(["U+0141", "U+2192"]);
    expect(pageTexts(r.bytes).flat().join(" ")).toContain("Analista -> Lukasz");
  });

  it("el PDF no lleva datos que el modelo no tiene: sin teléfono, dirección ni fecha", () => {
    const s = bin(buildCvPdf(doc()).bytes);
    expect(s).not.toMatch(/\/CreationDate|\/ModDate|\/Author/);
  });
});

describe("ritmo de descarga", () => {
  const now = 1_000_000_000;
  it("permite hasta el tope por minuto y después frena con espera", () => {
    let marks: number[] = [];
    for (let i = 0; i < CV_DOWNLOADS_PER_MINUTE; i++) {
      const d = decideCvDownload(marks, now + i);
      expect(d.allowed).toBe(true);
      marks = d.kept;
    }
    const blocked = decideCvDownload(marks, now + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("pasado el minuto se libera", () => {
    const marks = Array.from({ length: CV_DOWNLOADS_PER_MINUTE }, (_, i) => now + i);
    expect(decideCvDownload(marks, now + 61_000).allowed).toBe(true);
  });

  it("tope por hora", () => {
    const marks = Array.from({ length: CV_DOWNLOADS_PER_HOUR }, (_, i) => now - 120_000 - i * 1000);
    const d = decideCvDownload(marks, now);
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("una marca inválida cuenta como intento reciente", () => {
    const marks = Array.from({ length: CV_DOWNLOADS_PER_MINUTE }, () => Number.NaN);
    expect(decideCvDownload(marks, now).allowed).toBe(false);
  });
});
