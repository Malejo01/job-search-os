import { describe, expect, it } from "vitest";
import { buildCvDocument, cvDateRange, cvOtherLabel, cvPhone, type CvSourceData } from "./model";
import {
  cvBeforeAfter,
  cvBulletGuideQuestions,
  cvDownloadWarnings,
  cvGroupSkills,
  cvIsTaskBullet,
  cvLanguageLevelText,
  cvSkillsWithoutEvidence,
} from "./quality";

const base: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  country: "País A",
  links: {
    linkedin: "https://linkedin.example.com/in/persona",
    github: "https://github.example.com/persona",
    portfolio: "https://persona.example.com",
  },
  headline: "Analista de marketing",
  summary: "Analista con experiencia en campañas.",
  skills: [{ name: "Google Ads", category: "dominio" }],
  languages: [{ name: "Inglés", level: "A2" }],
  achievements: [],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2022-03",
      endMonth: "2026-11",
      bullets: ["Armé campañas de Google Ads para 3 marcas"],
    },
    {
      kind: "educacion",
      organization: "Universidad A",
      title: "Licenciatura",
      startMonth: "2015-03",
      endMonth: "2019-12",
      bullets: [],
    },
  ],
};

describe("contacto y links (R33-07)", () => {
  it("la URL completa va como texto en el encabezado, con su etiqueta", () => {
    const d = buildCvDocument(base, { lang: "es" });
    expect(d.contact).toEqual([
      "persona@example.com",
      "Ciudad A, País A",
      "LinkedIn: https://linkedin.example.com/in/persona",
      "GitHub: https://github.example.com/persona",
      "Portfolio: https://persona.example.com",
    ]);
    expect(d.missing).not.toContain("links");
  });

  it("solo https: un http, un javascript: o un link con usuario no llegan al CV", () => {
    const d = buildCvDocument(
      {
        ...base,
        links: {
          linkedin: "http://linkedin.example.com/in/persona",
          github: "javascript:alert(1)",
          portfolio: "https://usuario@persona.example.com",
        },
      },
      { lang: "es" },
    );
    expect(d.contact).toEqual(["persona@example.com", "Ciudad A, País A"]);
    expect(d.missing).toContain("links");
  });

  it("ciudad y país se pueden sacar sin tocar el resto; nunca hay teléfono ni dirección", () => {
    const d = buildCvDocument(base, { lang: "es", includePlace: false });
    expect(d.contact).not.toContain("Ciudad A, País A");
    expect(d.contact).toContain("persona@example.com");
    expect(JSON.stringify(d)).not.toMatch(/tel|phone|direcci/i);
  });

  it("títulos en un solo idioma: «Habilidades» en español, «Skills» en inglés", () => {
    const es = buildCvDocument(base, { lang: "es" }).sections.map((s) => s.title);
    expect(es).toContain("Habilidades");
    expect(es).not.toContain("Skills");
    const en = buildCvDocument(base, { lang: "en" }).sections.map((s) => s.title);
    expect(en).toContain("Skills");
    expect(en).not.toContain("Habilidades");
  });

  it("aviso antes de descargar: estudios, resumen y resultados en los logros", () => {
    expect(cvDownloadWarnings(buildCvDocument(base, { lang: "es" }))).toEqual([]);
    const sinNada = buildCvDocument(
      {
        ...base,
        summary: null,
        history: [{ ...base.history[0]!, bullets: ["Armé campañas de publicidad"] }],
      },
      { lang: "es" },
    );
    expect(cvDownloadWarnings(sinNada)).toEqual(["education", "summary", "results"]);
  });
});

describe("teléfono y cuarto link (R33-07, C-44 y C-45)", () => {
  it("el teléfono valida dígitos, espacios, + - y paréntesis, y falla cerrado", () => {
    expect(cvPhone("+00 00 5555-0000")).toBe("+00 00 5555-0000");
    expect(cvPhone("(011) 5555 0000")).toBe("(011) 5555 0000");
    for (const malo of [
      "",
      "123",
      "abc 12345678",
      "5555-0000 interno 3",
      "+00 00 5555-0000 x",
      "1".repeat(16),
      "https://x.example.com",
      "a@example.com",
      "55+55 0000 00",
    ]) {
      expect(cvPhone(malo)).toBeNull();
    }
  });

  it("sin marcar por defecto: el número no sale si no se pide, ni si no es válido", () => {
    const data = { ...base, phone: "+00 00 5555-0000" };
    expect(buildCvDocument(data, { lang: "es" }).contact).not.toContain("+00 00 5555-0000");
    expect(buildCvDocument(data, { lang: "es", includePhone: false }).contact.join()).not.toContain(
      "5555",
    );
    const con = buildCvDocument(data, { lang: "es", includePhone: true });
    expect(con.contact).toEqual([
      "persona@example.com",
      "+00 00 5555-0000",
      "Ciudad A, País A",
      "LinkedIn: https://linkedin.example.com/in/persona",
      "GitHub: https://github.example.com/persona",
      "Portfolio: https://persona.example.com",
    ]);
    const malo = buildCvDocument({ ...base, phone: "llamame" }, { lang: "es", includePhone: true });
    expect(malo.contact.join()).not.toContain("llamame");
  });

  it("la etiqueta del otro link es texto plano corto", () => {
    expect(cvOtherLabel("Behance")).toBe("Behance");
    expect(cvOtherLabel("Mi blog 2")).toBe("Mi blog 2");
    for (const malo of ["", "x".repeat(31), "<b>", "ver https://a.example.com", "a@example.com"]) {
      expect(cvOtherLabel(malo)).toBeNull();
    }
  });

  it("el otro link sale con su etiqueta (o «Otro»/«Other») y solo si es https", () => {
    const con = buildCvDocument(
      {
        ...base,
        links: { other: { label: "Behance", url: "https://behance.example.com/persona" } },
      },
      { lang: "es" },
    );
    expect(con.contact).toContain("Behance: https://behance.example.com/persona");
    const sinEtiqueta = buildCvDocument(
      { ...base, links: { other: { label: null, url: "https://blog.example.com" } } },
      { lang: "en" },
    );
    expect(sinEtiqueta.contact).toContain("Other: https://blog.example.com");
    const http = buildCvDocument(
      { ...base, links: { other: { label: "Blog", url: "http://blog.example.com" } } },
      { lang: "es" },
    );
    expect(http.contact.join()).not.toContain("blog.example.com");
  });
});

describe("«Actualidad» (C-62)", () => {
  const job = { ...base.history[0]! };
  it("un trabajo sin fin o que termina en el mes actual dice «Actualidad»", () => {
    expect(cvDateRange({ ...job, endMonth: null }, "es")).toBe("03/2022 – Actualidad");
    expect(cvDateRange(job, "es", "2026-11")).toBe("03/2022 – Actualidad");
    expect(cvDateRange(job, "en", "2026-11")).toBe("03/2022 – Present");
  });
  it("otro mes de fin queda como está, y un estudio no pasa a «Actualidad»", () => {
    expect(cvDateRange(job, "es", "2026-12")).toBe("03/2022 – 11/2026");
    expect(cvDateRange(base.history[1]!, "es", "2019-12")).toBe("03/2015 – 12/2019");
  });
  it("el modelo la usa con la fecha que le pasa quien llama; sin `today` no mira el reloj", () => {
    const withToday = buildCvDocument(base, { lang: "es", today: "2026-11" });
    expect(withToday.sections[1]!.blocks[0]!.detail).toBe("Empresa A | 03/2022 – Actualidad");
    const without = buildCvDocument(base, { lang: "es" });
    expect(without.sections[1]!.blocks[0]!.detail).toBe("Empresa A | 03/2022 – 11/2026");
  });
});

describe("idioma con su nivel explicado (C-64, C-69)", () => {
  it("explica el marco europeo y respeta lo que no lo es", () => {
    expect(cvLanguageLevelText("A2", "es")).toBe("A2, nivel básico");
    expect(cvLanguageLevelText("b2", "es")).toBe("B2, nivel intermedio alto");
    expect(cvLanguageLevelText("C1", "en")).toBe("C1, advanced level");
    expect(cvLanguageLevelText("Nativo", "es")).toBe("Nativo");
    expect(cvLanguageLevelText("Intermedio", "es")).toBe("Intermedio");
  });

  it("cada idioma en su línea y nunca suma uno que la persona no declaró", () => {
    const d = buildCvDocument(base, { lang: "es" });
    const idiomas = d.sections.find((s) => s.id === "languages")!;
    expect(idiomas.blocks.map((b) => b.detail)).toEqual(["Inglés: A2, nivel básico"]);
    expect(JSON.stringify(d)).not.toContain("Español");
    // sin idiomas cargados: queda vacío y va a faltantes
    const none = buildCvDocument({ ...base, languages: [] }, { lang: "es" });
    expect(none.sections.map((s) => s.id)).not.toContain("languages");
    expect(none.missing).toContain("languages");
  });
});

describe("categorías de habilidades según el rubro (C-60)", () => {
  it("un perfil de marketing no muestra «Nube: Vercel»: lo técnico va a «Herramientas»", () => {
    const g = cvGroupSkills(
      [
        { name: "Google Ads", category: "dominio" },
        { name: "GA4", category: "datos" },
        { name: "HubSpot", category: "dominio" },
        { name: "Vercel", category: "cloud" },
      ],
      "es",
    );
    expect(g.map((x) => x.label)).toEqual([
      "Conocimiento del rubro",
      "Datos y analítica",
      "Herramientas",
    ]);
    expect(g.find((x) => x.label === "Herramientas")!.names).toEqual(["Vercel"]);
  });

  it("un perfil técnico conserva sus categorías con nombre en español", () => {
    const g = cvGroupSkills(
      [
        { name: "TypeScript", category: "lenguaje" },
        { name: "React", category: "framework" },
        { name: "AWS", category: "cloud" },
        { name: "SQL", category: "datos" },
      ],
      "es",
    );
    expect(g.map((x) => x.label)).toEqual([
      "Lenguajes de programación",
      "Frameworks",
      "Nube",
      "Datos y analítica",
    ]);
  });

  it("sin categoría o «otra» va al final; una categoría escrita a mano se respeta; las claves raras no rompen", () => {
    const g = cvGroupSkills(
      [
        { name: "Excel" },
        { name: "Redes", category: "Marketing digital" },
        { name: "Cosa", category: "otra" },
        { name: "X", category: "constructor" },
      ],
      "es",
    );
    expect(g.map((x) => x.label)).toEqual(["Marketing digital", "constructor", null]);
    expect(g[2]!.names).toEqual(["Excel", "Cosa"]);
  });

  it("el modelo rotula lo sin categoría como «Otras» solo si hay otras categorías", () => {
    const d = buildCvDocument(
      {
        ...base,
        skills: [{ name: "SQL", category: "datos" }, { name: "Comunicación" }],
      },
      { lang: "es" },
    );
    expect(d.sections.find((s) => s.id === "skills")!.blocks.map((b) => b.detail)).toEqual([
      "Datos y analítica: SQL",
      "Otras: Comunicación",
    ]);
    const solo = buildCvDocument({ ...base, skills: [{ name: "SQL" }] }, { lang: "es" });
    expect(solo.sections.find((s) => s.id === "skills")!.blocks[0]!.detail).toBe("SQL");
  });
});

describe("avisos suaves (C-56, C-57, C-58, C-61, C-67)", () => {
  it("sin titular: aviso `no_headline`", () => {
    const d = buildCvDocument({ ...base, headline: null }, { lang: "es" });
    expect(d.notices).toContainEqual({ id: "no_headline" });
    expect(buildCvDocument(base, { lang: "es" }).notices).not.toContainEqual({ id: "no_headline" });
  });

  it("detecta viñetas de tarea y no las que traen cifras", () => {
    expect(cvIsTaskBullet("Ejecuté tareas de retail en el área comercial")).toBe(true);
    expect(cvIsTaskBullet("Gestioné el mantenimiento de la web")).toBe(true);
    expect(cvIsTaskBullet("Worked on reports for the sales team")).toBe(true);
    expect(cvIsTaskBullet("Gestioné 12 sucursales")).toBe(false);
    expect(cvIsTaskBullet("Armé campañas de Google Ads")).toBe(false);
  });

  it("las preguntas guía citan las palabras de la persona y no traen cifras ni respuestas", () => {
    const q = cvBulletGuideQuestions("Gestioné el mantenimiento de la web", "es");
    expect(q).toHaveLength(3);
    expect(q[0]).toContain("«Gestioné el mantenimiento de la web»");
    expect(q.join(" ")).not.toMatch(/\d/);
    expect(q[2]).toContain("no lo sumes");
    expect(cvBulletGuideQuestions("Handled the web", "en")[0]).toContain('"Handled the web"');
  });

  it("la viñeta citada se acorta sin cortar una palabra", () => {
    const largo = `Gestioné ${"mantenimiento de contenidos ".repeat(8)}`;
    const q = cvBulletGuideQuestions(largo, "es")[0]!;
    expect(q).toContain("…»");
    expect(q.length).toBeLessThan(200);
  });

  it("el modelo trae el aviso de tareas con sus preguntas", () => {
    const d = buildCvDocument(
      {
        ...base,
        history: [
          { ...base.history[0]!, bullets: ["Ejecuté tareas de retail en el área comercial"] },
        ],
      },
      { lang: "es" },
    );
    const notice = d.notices!.find((n) => n.id === "task_bullets");
    expect(notice).toBeDefined();
    if (notice?.id === "task_bullets") {
      expect(notice.items[0]!.text).toBe("Ejecuté tareas de retail en el área comercial");
      expect(notice.items[0]!.questions).toHaveLength(3);
    }
  });

  it("habilidades sin respaldo: aviso suave que no las quita", () => {
    const skills = [
      { name: "Google Ads", category: "dominio" },
      { name: "HubSpot", category: "dominio" },
      { name: "GA4", category: "datos" },
      { name: "Comunicación", category: "soft" },
    ];
    const d = buildCvDocument({ ...base, skills }, { lang: "es" });
    expect(cvSkillsWithoutEvidence(d, skills)).toEqual(["HubSpot", "GA4"]);
    expect(d.notices).toContainEqual({ id: "skills_without_evidence", skills: ["HubSpot", "GA4"] });
    // siguen en el CV
    expect(JSON.stringify(d.sections.find((s) => s.id === "skills"))).toContain("HubSpot");
  });

  it("no avisa habilidad por habilidad si no hay experiencia donde buscar", () => {
    const d = buildCvDocument({ ...base, history: [] }, { lang: "es" });
    expect(d.notices!.map((n) => n.id)).not.toContain("skills_without_evidence");
  });
});

describe("antes y después de una reescritura (C-68)", () => {
  it("muestra qué palabras de la persona se conservan y cuáles no", () => {
    const r = cvBeforeAfter(
      "Hacía reportes de ventas para el equipo",
      "Armé reportes de ventas semanales para el equipo comercial",
    );
    expect(r.changed).toBe(true);
    expect(r.keptWords).toEqual(expect.arrayContaining(["reportes", "ventas", "equipo"]));
    expect(r.droppedWords).toEqual(["hacia"]);
    expect(r.keepsOwnWords).toBe(true);
  });

  it("una reescritura que pierde la mayoría de las palabras se marca", () => {
    const r = cvBeforeAfter(
      "Atendía clientes en mostrador",
      "Impulsé la experiencia de compra omnicanal",
    );
    expect(r.keepsOwnWords).toBe(false);
  });

  it("si no cambió nada, no hay nada que elegir", () => {
    expect(cvBeforeAfter("Armé reportes", "  Armé   reportes ").changed).toBe(false);
  });
});
