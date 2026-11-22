import { describe, expect, it } from "vitest";
import type { CvDocument, CvSection } from "./cv-out/model";
import { CV_DIAGNOSIS_ITEM_IDS, diagnoseCv } from "./cv-diagnosis";

const bullets = [
  "Armé reportes semanales para el equipo de ventas con datos de tres sistemas",
  "Coordiné la migración de la planilla de clientes a una base compartida",
  "Reduje a la mitad el tiempo de carga de pedidos con una macro nueva",
];

function section(id: CvSection["id"], title: string, b: string[] = bullets): CvSection {
  return {
    id,
    title,
    blocks: [{ heading: "Analista", detail: "Empresa A · 2022 - 2024", bullets: b }],
  };
}

function fullDoc(): CvDocument {
  const filler = Array.from({ length: 6 }, (_, i) => `${bullets[i % 3]} número ${i}`);
  return {
    lang: "es",
    name: "Ana Ejemplo",
    headline: "Analista de datos",
    contact: ["ana@example.com", "Córdoba, Argentina"],
    sections: [
      {
        id: "summary",
        title: "Resumen",
        blocks: [
          {
            heading: null,
            detail:
              "Analista con experiencia en reportes y automatización de tareas administrativas para equipos comerciales.",
            bullets: [],
          },
        ],
      },
      {
        ...section("experience", "Experiencia", filler),
        blocks: [0, 1, 2].map(() => ({
          heading: "Analista",
          detail: "Empresa A · 2022 - 2024",
          bullets: filler,
        })),
      },
      section("education", "Educación", []),
      section("skills", "Skills", []),
      section("languages", "Idiomas", []),
    ],
    missing: [],
  };
}

const byId = (doc: CvDocument, id: string) => diagnoseCv(doc).find((i) => i.id === id)!;

describe("diagnoseCv", () => {
  it("devuelve los cinco ítems en el orden pedido", () => {
    expect(diagnoseCv(fullDoc()).map((i) => i.id)).toEqual([...CV_DIAGNOSIS_ITEM_IDS]);
    expect(CV_DIAGNOSIS_ITEM_IDS).toEqual([
      "structure",
      "keywords",
      "readability",
      "achievements",
      "sections",
    ]);
  });

  it("un CV completo y ordenado puntúa alto en lo que mide el código", () => {
    const doc = fullDoc();
    const s = byId(doc, "structure");
    const sec = byId(doc, "sections");
    const r = byId(doc, "readability");
    for (const item of [s, sec, r]) {
      expect(item.status).toBe("scored");
      expect(item.score).toBeGreaterThanOrEqual(8);
      expect(item.level).toBe("good");
    }
  });

  it("palabras clave y logros medibles quedan en «soon» sin puntaje inventado", () => {
    for (const id of ["keywords", "achievements"]) {
      const item = byId(fullDoc(), id);
      expect(item).toEqual({ id, status: "soon", score: null, level: null, advice: null });
    }
  });

  it("sin contacto ni titular baja la estructura y el consejo lo dice", () => {
    const doc = { ...fullDoc(), contact: [], headline: null };
    const s = byId(doc, "structure");
    expect(s.score).toBeLessThan(8);
    expect(s.level).not.toBe("good");
    expect(s.advice).toMatch(/contacto/i);
  });

  it("un CV vacío puntúa 0 con nivel «missing»", () => {
    const doc: CvDocument = { ...fullDoc(), name: "", headline: null, contact: [], sections: [] };
    for (const id of ["structure", "sections", "readability"]) {
      const item = byId(doc, id);
      expect(item.score).toBe(0);
      expect(item.level).toBe("missing");
    }
  });

  it("las secciones que faltan se nombran en el consejo", () => {
    const doc = fullDoc();
    doc.sections = doc.sections.filter((s) => s.id !== "skills" && s.id !== "languages");
    const sec = byId(doc, "sections");
    expect(sec.score).toBe(6);
    expect(sec.advice).toMatch(/Skills/);
    expect(sec.advice).toMatch(/Idiomas/);
  });

  it("proyectos valen como experiencia para quien recién empieza", () => {
    const doc = fullDoc();
    doc.sections = doc.sections.map((s) => (s.id === "experience" ? { ...s, id: "projects" } : s));
    expect(byId(doc, "sections").score).toBe(10);
  });

  it("viñetas larguísimas bajan la legibilidad", () => {
    const doc = fullDoc();
    const long = Array.from({ length: 6 }, () => "palabra ".repeat(60).trim());
    doc.sections = doc.sections.map((s) =>
      s.id === "experience" ? section("experience", "Experiencia", long) : s,
    );
    const r = byId(doc, "readability");
    expect(r.score).toBeLessThan(8);
    expect(r.advice).toMatch(/viñetas/);
  });

  it("las secciones vacías y el orden raro bajan la estructura", () => {
    const doc = fullDoc();
    doc.sections = [
      ...doc.sections.filter((s) => s.id === "education"),
      ...doc.sections.filter((s) => s.id !== "education"),
      { id: "projects", title: "Proyectos", blocks: [] },
    ];
    const s = byId(doc, "structure");
    expect(s.score).toBeLessThan(10);
  });

  it("los puntajes tienen un decimal como máximo y están entre 0 y 10", () => {
    for (const item of diagnoseCv(fullDoc())) {
      if (item.score === null) continue;
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(10);
      expect(Math.round(item.score * 10) / 10).toBe(item.score);
    }
  });

  it("es determinista y no muta la entrada", () => {
    const doc = fullDoc();
    const before = JSON.stringify(doc);
    expect(diagnoseCv(doc)).toEqual(diagnoseCv(doc));
    expect(JSON.stringify(doc)).toBe(before);
  });

  it("con una entrada de 2 MB responde en menos de 100 ms", () => {
    const huge = "palabra ".repeat(250_000); // ~2 MB
    const doc = fullDoc();
    doc.sections = Array.from({ length: 40 }, (_, i) => ({
      id: "experience" as const,
      title: `Experiencia ${i}`,
      blocks: Array.from({ length: 40 }, () => ({
        heading: huge.slice(0, 2_000),
        detail: huge.slice(0, 2_000),
        bullets: Array.from({ length: 40 }, () => huge.slice(0, 600)),
      })),
    }));
    diagnoseCv(doc); // calentamiento
    const t0 = performance.now();
    const out = diagnoseCv(doc);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(out).toHaveLength(5);
  });
});
