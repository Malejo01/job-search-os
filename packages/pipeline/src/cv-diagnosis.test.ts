import { describe, expect, it } from "vitest";
import type { CvDocument, CvSection } from "./cv-out/model";
import {
  CV_DIAGNOSIS_ITEM_IDS,
  cvDiagnosisLevel,
  cvDiagnosisMainFix,
  diagnoseCv,
} from "./cv-diagnosis";
import type { KeywordMarket } from "./cv-keywords";

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
  it("devuelve los seis ítems en el orden pedido (legibilidad y largo, separados)", () => {
    expect(diagnoseCv(fullDoc()).map((i) => i.id)).toEqual([...CV_DIAGNOSIS_ITEM_IDS]);
    expect(CV_DIAGNOSIS_ITEM_IDS).toEqual([
      "structure",
      "keywords",
      "readability",
      "length",
      "achievements",
      "sections",
    ]);
  });

  it("un CV completo y ordenado puntúa alto en lo que mide el código", () => {
    const doc = fullDoc();
    const s = byId(doc, "structure");
    const sec = byId(doc, "sections");
    const r = byId(doc, "readability");
    const l = byId(doc, "length");
    for (const item of [s, sec, r, l]) {
      expect(item.status).toBe("scored");
      expect(item.score).toBeGreaterThanOrEqual(8);
      expect(item.level).toBe("good");
    }
  });

  it("palabras clave quedan en «soon» sin puntaje inventado cuando no hay mercado", () => {
    const item = byId(fullDoc(), "keywords");
    expect(item).toEqual({
      id: "keywords",
      status: "soon",
      score: null,
      level: null,
      advice: null,
    });
  });

  describe("logros medibles", () => {
    const docWith = (bullets: string[]): CvDocument => {
      const doc = fullDoc();
      doc.sections = doc.sections.map((s) =>
        s.id === "experience" ? section("experience", "Experiencia", bullets) : s,
      );
      return doc;
    };

    it("puntúa por código con las viñetas de experiencia", () => {
      const item = byId(
        docWith([
          "Reduje los errores de carga un 18% en tres meses",
          "Lideré un equipo de 6 personas en el área comercial",
          "Atendí 120 clientes por mes con respuesta en el día",
          "Armé reportes semanales para el equipo de ventas",
        ]),
        "achievements",
      );
      expect(item.status).toBe("scored");
      expect(item.score).toBe(10);
      expect(item.level).toBe("good");
    });

    it("sin resultados baja, cita una viñeta real y no la reescribe", () => {
      const bullet = "Armé reportes semanales para el equipo de ventas";
      const item = byId(
        docWith([bullet, "Coordiné tareas del área administrativa"]),
        "achievements",
      );
      expect(item.score).toBe(0);
      expect(item.level).toBe("missing");
      expect(item.advice).toContain(`«${bullet}»`);
      expect(item.advice).toMatch(/número|porcentaje|cantidad/i);
    });

    it("un año suelto no cuenta como logro", () => {
      const item = byId(docWith(["Migré la base de datos en 2021 con el equipo"]), "achievements");
      expect(item.score).toBe(0);
    });

    it("con experiencia pero sin viñetas puntúa 0 («Para reforzar», no «Sin empezar») y pide escribirlas", () => {
      const item = byId(docWith([]), "achievements");
      expect(item.score).toBe(0);
      expect(item.level).toBe("missing");
      expect(item.advice).toMatch(/viñetas/);
      expect(item.status === "scored" && item.fixes).toEqual(["write_achievement"]);
    });

    it("viñetas vagas ya cargadas: el paso es reescribirlas con ayuda (C-42)", () => {
      const item = byId(docWith(["Coordiné tareas del área administrativa"]), "achievements");
      expect(item.status === "scored" && item.fixes).toEqual(["write_achievement"]);
      expect(item.level).toBe("missing");
    });

    it("las viñetas de educación y skills no se miran", () => {
      const doc = docWith([]);
      doc.sections = doc.sections.map((s) =>
        s.id === "skills" ? section("skills", "Skills", ["Mejoré un 50% todo"]) : s,
      );
      expect(byId(doc, "achievements").score).toBe(0);
    });
  });

  describe("palabras clave con el mercado del puesto", () => {
    const names = ["Reportes", "Automatización", "SQL", "Excel", "Python", "Power BI"];
    const mk = (jobs: number): KeywordMarket => ({
      jobs,
      skills: names.map((name, i) => ({ slug: name.toLowerCase(), name, mentions: 50 - i })),
    });
    const kw = (jobs: number, doc = fullDoc()) =>
      diagnoseCv(doc, { keywords: mk(jobs) }).find((i) => i.id === "keywords")!;

    it("puntúa con la proporción cubierta y nombra las que faltan", () => {
      const doc = fullDoc();
      doc.sections = doc.sections.map((s) =>
        s.id === "skills" ? section("skills", "Skills", ["SQL", "Excel"]) : s,
      );
      const item = kw(80, doc);
      // «Reportes» y «Automatización» salen del resumen y las viñetas del CV de ejemplo, más SQL y Excel
      expect(item.status).toBe("scored");
      // cuatro cubiertas sobre el piso del denominador (el mercado de ejemplo trae pocas skills)
      expect(item.score).toBe(5);
      expect(item.level).toBe("improvable");
      expect(item.advice).toMatch(/Python/);
      expect(item.advice).toMatch(/Power BI/);
      expect(item.advice).not.toMatch(/SQL/);
    });

    it("con menos de 20 avisos queda «no_data» sin puntaje ni nivel", () => {
      expect(kw(19)).toEqual({
        id: "keywords",
        status: "no_data",
        score: null,
        level: null,
        advice: null,
      });
    });

    it("con mercado nulo sigue en «soon»", () => {
      const item = diagnoseCv(fullDoc(), { keywords: null }).find((i) => i.id === "keywords")!;
      expect(item.status).toBe("soon");
    });

    it("un CV que las trae todas puntúa «good» y no pide nada", () => {
      const eight = [...names, "Git", "Docker"];
      const doc = fullDoc();
      doc.sections = doc.sections.map((s) =>
        s.id === "skills" ? section("skills", "Skills", eight) : s,
      );
      const item = diagnoseCv(doc, {
        keywords: {
          jobs: 80,
          skills: eight.map((name, i) => ({ slug: name.toLowerCase(), name, mentions: 50 - i })),
        },
      }).find((i) => i.id === "keywords")!;
      expect(item.score).toBe(10);
      expect(item.level).toBe("good");
      expect(item.advice).toMatch(/pedidas/);
    });

    it("lee también el titular y los encabezados", () => {
      const doc = fullDoc();
      doc.headline = "Analista de Python";
      doc.sections = doc.sections.map((s) =>
        s.id === "skills"
          ? { ...s, blocks: [{ heading: "Power BI", detail: null, bullets: [] }] }
          : s,
      );
      const item = kw(80, doc);
      expect(item.advice ?? "").not.toMatch(/Python|Power BI/);
    });
  });

  it("sin contacto ni titular baja la estructura y el consejo lo dice", () => {
    const doc = { ...fullDoc(), contact: [], headline: null };
    const s = byId(doc, "structure");
    expect(s.score).toBeLessThan(8);
    expect(s.level).not.toBe("good");
    expect(s.advice).toMatch(/contacto/i);
  });

  it("un CV vacío puntúa 0 con nivel «empty» (Sin empezar) en lo que se puede medir", () => {
    const doc: CvDocument = { ...fullDoc(), name: "", headline: null, contact: [], sections: [] };
    for (const id of ["structure", "sections"]) {
      const item = byId(doc, id);
      expect(item.score).toBe(0);
      expect(item.level).toBe("empty");
    }
  });

  describe("sin experiencia cargada (C-40): una acción principal y el resto en pausa", () => {
    const noExperience = (): CvDocument => {
      const doc = fullDoc();
      doc.sections = doc.sections.filter((s) => s.id !== "experience");
      return doc;
    };

    it("legibilidad, largo y logros quedan «waiting» sin puntaje ni nivel", () => {
      for (const id of ["readability", "length", "achievements"]) {
        expect(byId(noExperience(), id)).toEqual({
          id,
          status: "waiting",
          score: null,
          level: null,
          advice: null,
          needs: "experience",
        });
      }
    });

    it("estructura, secciones y palabras clave siguen midiéndose", () => {
      const doc = noExperience();
      expect(byId(doc, "structure").status).toBe("scored");
      expect(byId(doc, "sections").status).toBe("scored");
    });

    it("la acción principal es «add_experience»", () => {
      expect(cvDiagnosisMainFix(diagnoseCv(noExperience()))).toBe("add_experience");
    });

    it("con experiencia no hay acción principal compartida", () => {
      expect(cvDiagnosisMainFix(diagnoseCv(fullDoc()))).toBeNull();
    });

    it("un CV vacío entero: todo lo que depende de experiencia espera", () => {
      const empty: CvDocument = { ...fullDoc(), sections: [] };
      expect(byId(empty, "achievements").status).toBe("waiting");
      expect(cvDiagnosisMainFix(diagnoseCv(empty))).toBe("add_experience");
    });

    it("proyectos valen como experiencia: no se pausa nada", () => {
      const doc = fullDoc();
      doc.sections = doc.sections.map((s) =>
        s.id === "experience" ? { ...s, id: "projects" as const } : s,
      );
      expect(byId(doc, "achievements").status).toBe("scored");
      expect(cvDiagnosisMainFix(diagnoseCv(doc))).toBeNull();
    });
  });

  describe("palabra y número entero con los cortes del plan", () => {
    it.each([
      [0, "empty"],
      [1, "missing"],
      [4, "missing"],
      [5, "improvable"],
      [7, "improvable"],
      [8, "good"],
      [10, "good"],
    ] as const)("%i → %s", (score, level) => {
      expect(cvDiagnosisLevel(score)).toBe(level);
    });

    it("el número es entero y la palabra sale del entero que se muestra (redondeo)", () => {
      // 4,4 → 4 «Para reforzar»; 4,5 → 5 «En camino»; 7,5 → 8 «Sólido»; 0,4 → 0 «Sin empezar»
      expect([cvDiagnosisLevel(4.4), cvDiagnosisLevel(4.5)]).toEqual(["missing", "improvable"]);
      expect([cvDiagnosisLevel(7.4), cvDiagnosisLevel(7.5)]).toEqual(["improvable", "good"]);
      expect([cvDiagnosisLevel(0.4), cvDiagnosisLevel(0.5)]).toEqual(["empty", "missing"]);
    });

    it("fuera de rango o NaN se acota", () => {
      expect(cvDiagnosisLevel(-3)).toBe("empty");
      expect(cvDiagnosisLevel(14)).toBe("good");
      expect(cvDiagnosisLevel(Number.NaN)).toBe("empty");
    });
  });

  describe("cada «falta» trae su paso concreto (tabla 8.2)", () => {
    const fixes = (doc: CvDocument, id: string) => {
      const item = byId(doc, id);
      return item.status === "scored" ? item.fixes : null;
    };

    it("estructura: sin titular → add_headline; sin contacto → add_contact", () => {
      const doc = { ...fullDoc(), headline: null, contact: [] };
      expect(fixes(doc, "structure")).toEqual(["add_contact", "add_headline"]);
    });

    it("estructura completa no pide nada", () => {
      expect(fixes(fullDoc(), "structure")).toEqual([]);
    });

    it("secciones: un paso por sección que falta, en orden", () => {
      const doc = fullDoc();
      doc.sections = doc.sections.filter((s) => s.id !== "summary" && s.id !== "education");
      expect(fixes(doc, "sections")).toEqual(["add_summary", "add_education"]);
    });

    it("palabras clave que faltan → mark_keywords; sin faltantes, nada", () => {
      const names = ["Python", "Power BI"];
      const market = {
        jobs: 80,
        skills: names.map((name, i) => ({ slug: name.toLowerCase(), name, mentions: 50 - i })),
      };
      const kw = diagnoseCv(fullDoc(), { keywords: market }).find((i) => i.id === "keywords")!;
      expect(kw.status === "scored" && kw.fixes).toEqual(["mark_keywords"]);
    });
  });

  describe("legibilidad y largo por separado (C-39)", () => {
    it("viñetas largas bajan la legibilidad pero no el largo", () => {
      const doc = fullDoc();
      const long = Array.from({ length: 6 }, () => "palabra ".repeat(25).trim() + " x".repeat(40));
      doc.sections = doc.sections.map((s) =>
        s.id === "experience"
          ? {
              ...s,
              blocks: [0, 1, 2].map(() => ({ heading: "Analista", detail: null, bullets: long })),
            }
          : s,
      );
      expect((byId(doc, "readability") as { score: number }).score).toBeLessThan(8);
      expect(byId(doc, "length").advice ?? "").not.toMatch(/viñetas/);
    });

    it("un CV corto baja el largo, no la legibilidad", () => {
      const doc = fullDoc();
      doc.sections = [
        {
          id: "experience",
          title: "Experiencia",
          blocks: [{ heading: "Analista", detail: null, bullets }],
        },
      ];
      expect((byId(doc, "readability") as { score: number }).score).toBe(10);
      const len = byId(doc, "length") as { score: number; level: string; advice: string };
      expect(len.score).toBeLessThan(8);
      expect(len.advice).toMatch(/corto/);
    });
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

  it("los puntajes son enteros entre 0 y 10", () => {
    for (const item of diagnoseCv(fullDoc())) {
      if (item.score === null) continue;
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(10);
      expect(Number.isInteger(item.score)).toBe(true);
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
    expect(out).toHaveLength(6);
  });
});
