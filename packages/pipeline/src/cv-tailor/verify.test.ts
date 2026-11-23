import { describe, expect, it } from "vitest";
import { buildCvDocument, type CvSourceData } from "../cv-out/model";
import { cvTailorRefs, verifyCvTailor } from "./verify";

// CV inventado: ningún dato real.
const data: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  city: "Ciudad A",
  country: "País A",
  links: { linkedin: "https://example.com/in/persona" },
  headline: "Analista de datos",
  summary: null,
  skills: [
    { name: "SQL", category: "Datos" },
    { name: "Excel", category: "Datos" },
    { name: "Python", category: "Datos" },
    { name: "Comunicación" },
  ],
  languages: [{ name: "Inglés", level: "B2" }],
  achievements: ["Redujo el cierre mensual de 5 a 3 días"],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: [
        "Armé reportes semanales de ventas en Excel",
        "Coordiné pedidos de datos con 4 áreas",
        "Automaticé la carga de datos con SQL",
      ],
    },
    {
      kind: "trabajo",
      organization: "Empresa B",
      title: "Asistente administrativa",
      startMonth: "2019-01",
      endMonth: "2021-02",
      bullets: ["Organicé la agenda de la gerencia"],
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
const doc = buildCvDocument(data, { lang: "es", includeEmail: true });
const KNOWN = ["sql", "excel", "python", "kubernetes", "docker", "power bi"];

const bulletsOf = (d: typeof doc, ref: string): string[] => {
  const hit = cvTailorRefs(d).get(ref);
  if (!hit) throw new Error(`sin ${ref}`);
  return d.sections.find((s) => s.id === hit.sectionId)!.blocks[hit.blockIndex]!.bullets;
};

const exp0 = "experience-0";
const orig0 = bulletsOf(doc, exp0);

describe("cvTailorRefs", () => {
  it("da una referencia estable a cada entrada con viñetas posibles, sin resumen ni skills", () => {
    const refs = [...cvTailorRefs(doc).keys()];
    expect(refs).toEqual(["experience-0", "experience-1", "education-0", "achievements-0"]);
  });
});

describe("verifyCvTailor: lo que pasa", () => {
  it("una salida vacía deja el CV igual y lo informa", () => {
    const r = verifyCvTailor(doc, { entries: [], skills: [], changes: [] }, { knownTerms: KNOWN });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.changed).toBe(false);
    expect(r.value.document).toEqual(doc);
  });

  it("reordenar las viñetas de una entrada es válido y no toca nombre, contacto ni fechas", () => {
    const reordered = [orig0[2]!, orig0[0]!, orig0[1]!];
    const r = verifyCvTailor(
      doc,
      {
        entries: [{ ref: exp0, bullets: reordered }],
        skills: [],
        changes: [{ what: "Puse primero la automatización", why: "La oferta pide SQL." }],
      },
      { knownTerms: KNOWN },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(bulletsOf(r.value.document, exp0)).toEqual(reordered);
    expect(r.value.changed).toBe(true);
    expect(r.value.document.name).toBe(doc.name);
    expect(r.value.document.contact).toEqual(doc.contact);
    expect(r.value.document.missing).toEqual(doc.missing);
    // los títulos y las fechas salen del CV original, no del modelo
    expect(r.value.document.sections.map((s) => s.title)).toEqual(doc.sections.map((s) => s.title));
    expect(r.value.document.sections[0]!.blocks[0]!.detail).toBe(
      doc.sections[0]!.blocks[0]!.detail,
    );
    expect(r.value.changes).toHaveLength(1);
  });

  it("reescribir una viñeta con las palabras y los datos del CV es válido", () => {
    const r = verifyCvTailor(
      doc,
      {
        entries: [
          {
            ref: exp0,
            bullets: [
              "Automaticé la carga de datos con SQL y armé reportes semanales de ventas en Excel",
              orig0[1]!,
            ],
          },
        ],
        skills: [],
        changes: [],
      },
      { knownTerms: KNOWN },
    );
    expect(r.ok).toBe(true);
  });

  it("quitar viñetas es válido si queda al menos una", () => {
    const r = verifyCvTailor(
      doc,
      { entries: [{ ref: exp0, bullets: [orig0[2]!] }], skills: [], changes: [] },
      { knownTerms: KNOWN },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(bulletsOf(r.value.document, exp0)).toEqual([orig0[2]]);
  });

  it("reordenar las skills conserva las categorías y no pierde ninguna", () => {
    const r = verifyCvTailor(
      doc,
      { entries: [], skills: ["Python", "sql"], changes: [] },
      { knownTerms: KNOWN },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const skills = r.value.document.sections.find((s) => s.id === "skills")!;
    expect(skills.blocks[0]!.detail).toBe("Datos: Python, SQL, Excel");
    expect(skills.blocks[1]!.detail).toBe("Otras: Comunicación");
  });

  it("los cambios que explica el modelo se limpian: sin links y con tope", () => {
    const r = verifyCvTailor(
      doc,
      {
        entries: [],
        skills: [],
        changes: [
          { what: "Visitá https://ejemplo.test ahora", why: "Para ver más información." },
          { what: "Reordené las skills", why: "La oferta pide Python primero." },
        ],
      },
      { knownTerms: KNOWN },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.changes).toEqual([
      { what: "Reordené las skills", why: "La oferta pide Python primero." },
    ]);
  });
});

describe("verifyCvTailor: lo que se descarta", () => {
  const rejected = (output: unknown) => {
    const r = verifyCvTailor(doc, output, { knownTerms: KNOWN });
    expect(r.ok).toBe(false);
    return r.ok ? null : r.error;
  };

  it("un número que el CV no tenía", () => {
    const e = rejected({
      entries: [{ ref: exp0, bullets: ["Armé reportes semanales que ahorraron 40% del tiempo"] }],
      skills: [],
      changes: [],
    });
    expect(e).toMatchObject({ reason: "bullet_rejected", ref: exp0 });
    expect(e?.detail).toContain("number_not_in_answers");
  });

  it("un número en letras que el CV no tenía", () => {
    const e = rejected({
      entries: [{ ref: exp0, bullets: ["Coordiné pedidos de datos con doce áreas"] }],
      skills: [],
      changes: [],
    });
    expect(e?.detail).toContain("number_not_in_answers");
  });

  it("una empresa o nombre propio que el CV no tenía", () => {
    const e = rejected({
      entries: [{ ref: exp0, bullets: ["Armé reportes para Empresa Z con Excel"] }],
      skills: [],
      changes: [],
    });
    expect(e?.detail).toContain("name_not_in_answers");
  });

  it("una tecnología del catálogo que el CV no tenía, aunque esté en minúscula", () => {
    const e = rejected({
      entries: [{ ref: exp0, bullets: ["Armé reportes semanales con docker y Excel"] }],
      skills: [],
      changes: [],
    });
    expect(e?.detail).toContain("technology_not_in_answers");
  });

  it("una tecnología que está en las skills pero no en esa entrada se atribuye mal: se descarta", () => {
    const e = rejected({
      entries: [{ ref: "experience-1", bullets: ["Organicé la agenda de la gerencia con Python"] }],
      skills: [],
      changes: [],
    });
    expect(e?.detail).toContain("technology_not_in_answers");
  });

  it("un link o un email", () => {
    expect(
      rejected({
        entries: [{ ref: exp0, bullets: ["Armé reportes semanales en Excel www.ejemplo.test"] }],
        skills: [],
        changes: [],
      })?.detail,
    ).toContain("link_or_email");
  });

  it("una skill que no estaba", () => {
    expect(rejected({ entries: [], skills: ["Docker", "SQL"], changes: [] })).toMatchObject({
      reason: "skill_not_in_cv",
    });
  });

  it("una referencia que no existe, repetida o del resumen", () => {
    expect(
      rejected({
        entries: [{ ref: "experience-9", bullets: [orig0[0]!] }],
        skills: [],
        changes: [],
      }),
    ).toMatchObject({ reason: "unknown_ref" });
    expect(
      rejected({
        entries: [
          { ref: exp0, bullets: [orig0[0]!] },
          { ref: exp0, bullets: [orig0[1]!] },
        ],
        skills: [],
        changes: [],
      }),
    ).toMatchObject({ reason: "duplicate_ref" });
    expect(
      rejected({ entries: [{ ref: "summary-0", bullets: ["Texto"] }], skills: [], changes: [] }),
    ).toMatchObject({ reason: "unknown_ref" });
  });

  it("más viñetas que las del CV o una entrada que se quedó sin ninguna", () => {
    expect(
      rejected({
        entries: [
          { ref: "experience-1", bullets: ["Organicé la agenda de la gerencia", "Armé la agenda"] },
        ],
        skills: [],
        changes: [],
      }),
    ).toMatchObject({ reason: "too_many_bullets" });
    expect(
      rejected({ entries: [{ ref: exp0, bullets: [] }], skills: [], changes: [] }),
    ).toMatchObject({ reason: "empty_entry" });
    // una entrada sin viñetas en el CV tampoco puede recibir
    expect(
      rejected({
        entries: [{ ref: "education-0", bullets: ["Me recibí con honores"] }],
        skills: [],
        changes: [],
      }),
    ).toMatchObject({ reason: "too_many_bullets" });
  });

  it("una salida con forma rota o con campos de más (el navegador no es de fiar)", () => {
    expect(rejected({ entries: "x", skills: [], changes: [] })).toMatchObject({
      reason: "invalid_output",
    });
    expect(rejected({ entries: [], skills: [], changes: [], name: "Otra Persona" })).toMatchObject({
      reason: "invalid_output",
    });
    expect(rejected(null)).toMatchObject({ reason: "invalid_output" });
  });
});

describe("verifyCvTailor: límites de tamaño", () => {
  it("una salida de 2 MB se rechaza en menos de 100 ms", () => {
    const huge = "a".repeat(2 * 1024 * 1024);
    const t0 = performance.now();
    const r = verifyCvTailor(doc, {
      entries: [{ ref: exp0, bullets: [huge] }],
      skills: [],
      changes: [],
    });
    expect(r.ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
