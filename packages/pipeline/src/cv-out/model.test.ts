import { describe, expect, it } from "vitest";
import { buildCvDocument, CV_MAX_BULLETS, type CvSourceData } from "./model";

const base: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  country: "País A",
  links: { linkedin: "https://example.com/in/persona", github: "javascript:alert(1)" },
  headline: "Analista de datos",
  summary: "Analista con experiencia en reportes.",
  skills: [
    { name: "SQL", category: "Datos" },
    { name: "sql", category: "Datos" },
    { name: "Excel", category: "Datos" },
    { name: "Comunicación" },
  ],
  languages: [{ name: "Inglés", level: "B2" }],
  achievements: ["Reduje el cierre mensual de 5 a 3 días"],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: ["- armé reportes", "Armé reportes", "x".repeat(400)],
    },
    {
      kind: "educacion",
      organization: "Universidad A",
      title: "Licenciatura en Estadística",
      startMonth: "2015-03",
      endMonth: "2019-12",
      bullets: [],
    },
    {
      kind: "certificacion",
      organization: "Entidad A",
      title: "Certificado B",
      startMonth: "bad",
      endMonth: null,
      bullets: [],
    },
  ],
};

describe("buildCvDocument", () => {
  it("arma las secciones estándar en orden y en español", () => {
    const d = buildCvDocument(base, { lang: "es" });
    expect(d.sections.map((s) => s.title)).toEqual([
      "Resumen",
      "Experiencia",
      "Educación",
      "Certificaciones",
      "Skills",
      "Idiomas",
      "Logros",
    ]);
    expect(d.missing).toEqual([]);
    expect(d.name).toBe("Persona Ficticia");
  });

  it("en inglés usa los títulos y «Present»", () => {
    const d = buildCvDocument(base, { lang: "en" });
    expect(d.sections.map((s) => s.title)).toContain("Experience");
    const exp = d.sections.find((s) => s.id === "experience")!;
    expect(exp.blocks[0]!.detail).toBe("Empresa A | 03/2021 – Present");
  });

  it("formatea fechas MM/AAAA y descarta las inválidas", () => {
    const d = buildCvDocument(base, { lang: "es" });
    expect(d.sections.find((s) => s.id === "experience")!.blocks[0]!.detail).toBe(
      "Empresa A | 03/2021 – Actual",
    );
    expect(d.sections.find((s) => s.id === "education")!.blocks[0]!.detail).toBe(
      "Universidad A | 03/2015 – 12/2019",
    );
    expect(d.sections.find((s) => s.id === "certifications")!.blocks[0]!.detail).toBe("Entidad A");
  });

  it("limpia, deduplica y acota las viñetas", () => {
    const b = buildCvDocument(base, { lang: "es" }).sections.find((s) => s.id === "experience")!
      .blocks[0]!;
    expect(b.bullets[0]).toBe("Armé reportes");
    expect(b.bullets).toHaveLength(2);
    expect(b.bullets[1]!.length).toBeLessThanOrEqual(220);
    expect(b.bullets.length).toBeLessThanOrEqual(CV_MAX_BULLETS);
  });

  it("agrupa skills por categoría sin repetir", () => {
    const s = buildCvDocument(base, { lang: "es" }).sections.find((x) => x.id === "skills")!;
    expect(s.blocks.map((b) => b.detail)).toEqual(["Datos: SQL, Excel", "Otras: Comunicación"]);
  });

  it("contacto: email, ciudad y solo links http(s); sin teléfono ni datos personales", () => {
    const d = buildCvDocument(base, { lang: "es" });
    expect(d.contact).toEqual([
      "persona@example.com",
      "Ciudad A, País A",
      "LinkedIn: https://example.com/in/persona",
    ]);
    expect(buildCvDocument(base, { lang: "es", includeEmail: false }).contact).not.toContain(
      "persona@example.com",
    );
  });

  it("lo que falta queda vacío y va a faltantes, sin inventar", () => {
    const d = buildCvDocument(
      { displayName: "Persona Ficticia", skills: [], languages: [], achievements: [], history: [] },
      { lang: "es" },
    );
    expect(d.sections).toEqual([]);
    expect(d.missing).toEqual([
      "links",
      "summary",
      "experience",
      "education",
      "skills",
      "languages",
    ]);
  });
});
