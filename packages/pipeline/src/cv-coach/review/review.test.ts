import { describe, expect, it } from "vitest";
import { computeDemand } from "../../skills/market";
import { CV_COACH_MAX_ISSUES, CV_COACH_MAX_ISSUES_PER_ITEM } from "../issues";
import { cvIssueSchema, type CvReviewProposedIssue } from "../schemas";
import {
  buildCvDiagnosis,
  cvSkillGaps,
  revalidateCvIssues,
  type CvReviewContext,
  type CvReviewItem,
} from "./review";

// Datos inventados: «Empresa A», «Proyecto 1», cargos ficticios.
const JOB_NOW = "0b3f2c4e-1111-4222-8333-000000000001";
const JOB_OLD = "0b3f2c4e-1111-4222-8333-000000000002";
const PROJECT = "0b3f2c4e-1111-4222-8333-000000000003";
const STUDY = "0b3f2c4e-1111-4222-8333-000000000004";

const items: CvReviewItem[] = [
  {
    id: JOB_OLD,
    kind: "trabajo",
    organization: "Empresa B",
    title: "Asistente de datos",
    startMonth: "2019-03",
    endMonth: "2021-02",
    bullets: ["Armé reportes semanales en Excel", "Ayudé al equipo"],
    link: null,
  },
  {
    id: JOB_NOW,
    kind: "trabajo",
    organization: "Empresa A",
    title: "Analista de datos",
    startMonth: "2021-03",
    endMonth: null,
    bullets: ["Automaticé tableros de ventas con Python", "Responsable de reportes"],
    link: null,
  },
  {
    id: PROJECT,
    kind: "proyecto",
    organization: "Proyecto 1",
    title: "Desarrollador",
    startMonth: null,
    endMonth: null,
    bullets: ["Buscador de eventos con mapa"],
    link: null,
  },
  {
    id: STUDY,
    kind: "educacion",
    organization: "Instituto Ficticio",
    title: "Tecnicatura en análisis de sistemas",
    startMonth: "2015-03",
    endMonth: "2018-12",
    bullets: [],
    link: null,
  },
];

const taxonomy = [
  { slug: "python", name: "Python", aliases: [] },
  { slug: "sql", name: "SQL", aliases: [] },
  { slug: "power-bi", name: "Power BI", aliases: ["powerbi"] },
  { slug: "excel", name: "Excel", aliases: [] },
  { slug: "tableau", name: "Tableau", aliases: [] },
  { slug: "dbt", name: "dbt", aliases: [] },
];

const job = (slugs: string[]) => ({
  jobId: slugs.join(","),
  score: null,
  skills: slugs.map((slug) => ({ slug, isMust: true })),
});

// Pool: SQL y Power BI muy pedidas; Python y Excel también; Tableau una sola vez (no alcanza)
const demand = computeDemand([
  job(["sql", "power-bi", "python", "excel"]),
  job(["sql", "power-bi", "python"]),
  job(["sql", "power-bi", "excel"]),
  job(["sql", "tableau"]),
]);

const ctx: CvReviewContext = {
  target: "Analista de datos",
  items,
  // SQL la declara pero ningún trabajo lo muestra; Python y Excel tienen evidencia
  personSkills: ["sql", "python", "excel"],
  taxonomy,
  demand,
  summary: null,
};

const proposed = (over: Partial<CvReviewProposedIssue> = {}): CvReviewProposedIssue => ({
  type: "logro_sin_resultado",
  ref: { section: "experience", itemId: JOB_NOW, field: "bullets" },
  quote: null,
  skillSlug: null,
  severity: "media",
  ...over,
});

describe("brechas de skills desde datos (computeDemand)", () => {
  it("brecha_con_puesto: pedida y ausente del CV; skill_pedida_sin_evidencia: declarada sin trabajo que la muestre", () => {
    const gaps = cvSkillGaps(ctx);
    expect(gaps).toEqual([
      { type: "skill_pedida_sin_evidencia", skillSlug: "sql", severity: "alta" },
      { type: "brecha_con_puesto", skillSlug: "power-bi", severity: "alta" },
    ]);
  });

  it("sin pool no hay brechas (no se inventan)", () => {
    expect(cvSkillGaps({ ...ctx, demand: [] })).toEqual([]);
  });

  it("una skill con evidencia en un proyecto no es brecha", () => {
    const withBi = items.map((i) =>
      i.id === PROJECT ? { ...i, bullets: [...i.bullets, "Stack: Power BI y SQL"] } : i,
    );
    expect(cvSkillGaps({ ...ctx, items: withBi })).toEqual([]);
  });
});

describe("validación de referencias", () => {
  it("descarta un problema con ref a un ítem inexistente", () => {
    const out = buildCvDiagnosis(ctx, [
      proposed({ ref: { section: "experience", itemId: "no-existe", field: "bullets" } }),
    ]);
    expect(out.filter((i) => i.source === "model")).toEqual([]);
  });

  it("descarta un problema cuya sección no coincide con el tipo del ítem", () => {
    const out = buildCvDiagnosis(ctx, [
      proposed({ ref: { section: "projects", itemId: JOB_NOW, field: "bullets" } }),
    ]);
    expect(out.filter((i) => i.source === "model")).toEqual([]);
  });

  it("descarta un skillSlug fuera de la taxonomía", () => {
    const out = buildCvDiagnosis(ctx, [proposed({ skillSlug: "kubernetes" })]);
    expect(out.filter((i) => i.source === "model")).toEqual([]);
  });

  it("fecha_faltante solo si el ítem no tiene fecha; proyecto_sin_stack_o_link solo en proyectos", () => {
    const out = buildCvDiagnosis(ctx, [
      proposed({
        type: "fecha_faltante",
        ref: { section: "experience", itemId: JOB_NOW, field: "dates" },
      }),
      proposed({
        type: "fecha_faltante",
        ref: { section: "projects", itemId: PROJECT, field: "dates" },
      }),
      proposed({
        type: "proyecto_sin_stack_o_link",
        ref: { section: "experience", itemId: JOB_NOW, field: null },
      }),
      proposed({
        type: "proyecto_sin_stack_o_link",
        ref: { section: "projects", itemId: PROJECT, field: "stack" },
      }),
    ]);
    const model = out.filter((i) => i.source === "model");
    expect(model.map((i) => [i.type, i.ref.itemId])).toEqual([
      ["proyecto_sin_stack_o_link", PROJECT],
      ["fecha_faltante", PROJECT],
    ]);
  });

  it("resumen_generico solo si hay resumen", () => {
    const summary = proposed({
      type: "resumen_generico",
      ref: { section: "summary", itemId: null, field: null },
    });
    expect(buildCvDiagnosis(ctx, [summary]).some((i) => i.type === "resumen_generico")).toBe(false);
    expect(
      buildCvDiagnosis({ ...ctx, summary: "Analista con experiencia" }, [summary]).some(
        (i) => i.type === "resumen_generico",
      ),
    ).toBe(true);
  });
});

describe("citas", () => {
  it("conserva una cita que es substring normalizado del ítem (mayúsculas, acentos y espacios)", () => {
    const [issue] = buildCvDiagnosis({ ...ctx, demand: [] }, [
      proposed({ quote: "  AUTOMATICE tableros   de ventas " }),
    ]);
    expect(issue?.quote).toBe("AUTOMATICE tableros de ventas");
  });

  it("una cita que no está en el ítem queda sin cita (el problema sigue)", () => {
    const out = buildCvDiagnosis({ ...ctx, demand: [] }, [
      // está en otro ítem, no en este
      proposed({ quote: "Armé reportes semanales en Excel" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.quote).toBeNull();
  });

  it("una cita demasiado corta no cuenta", () => {
    const [issue] = buildCvDiagnosis({ ...ctx, demand: [] }, [proposed({ quote: "con" })]);
    expect(issue?.quote).toBeNull();
  });
});

describe("brechas: el modelo solo cuenta si coincide con los datos", () => {
  it("brecha que el modelo no vio pero los datos sí → agregada con source data", () => {
    const out = buildCvDiagnosis(ctx, []);
    expect(out.map((i) => [i.type, i.skillSlug, i.source])).toEqual([
      ["brecha_con_puesto", "power-bi", "data"],
      ["skill_pedida_sin_evidencia", "sql", "data"],
    ]);
    expect(out.every((i) => i.ref.section === "skills" && i.ref.itemId === i.skillSlug)).toBe(true);
  });

  it("brecha del modelo que coincide → una sola, marcada model; la que no coincide se descarta", () => {
    const out = buildCvDiagnosis(ctx, [
      proposed({
        type: "brecha_con_puesto",
        ref: { section: "skills", itemId: "power-bi", field: null },
        skillSlug: "power-bi",
        severity: "baja",
      }),
      // Python tiene evidencia: no es brecha aunque el modelo lo diga
      proposed({
        type: "brecha_con_puesto",
        ref: { section: "skills", itemId: "python", field: null },
        skillSlug: "python",
        severity: "alta",
      }),
    ]);
    const gaps = out.filter((i) => i.type === "brecha_con_puesto");
    expect(gaps).toHaveLength(1);
    // la severidad sale de los datos, no del modelo
    expect(gaps[0]).toMatchObject({ skillSlug: "power-bi", source: "model", severity: "alta" });
  });
});

describe("orden y recorte", () => {
  it("severidad, después prioridad por tipo, después el ítem más reciente", () => {
    const out = buildCvDiagnosis({ ...ctx, demand: [] }, [
      proposed({
        type: "vineta_sin_verbo",
        ref: { section: "experience", itemId: JOB_OLD, field: "bullets" },
        severity: "alta",
      }),
      proposed({
        type: "tarea_vaga",
        ref: { section: "experience", itemId: JOB_OLD, field: "bullets" },
        severity: "media",
      }),
      proposed({
        type: "tarea_vaga",
        ref: { section: "experience", itemId: JOB_NOW, field: "bullets" },
        severity: "media",
      }),
      proposed({
        type: "logro_sin_resultado",
        ref: { section: "experience", itemId: JOB_OLD, field: "bullets" },
        severity: "media",
      }),
    ]);
    expect(out.map((i) => [i.id, i.type, i.ref.itemId])).toEqual([
      ["iss:1", "vineta_sin_verbo", JOB_OLD],
      ["iss:2", "logro_sin_resultado", JOB_OLD],
      ["iss:3", "tarea_vaga", JOB_NOW],
      ["iss:4", "tarea_vaga", JOB_OLD],
    ]);
  });

  it("el orden no depende del orden en que el modelo los propuso", () => {
    const list = [
      proposed({
        type: "tarea_vaga",
        ref: { section: "experience", itemId: JOB_OLD, field: "bullets" },
      }),
      proposed({ type: "logro_sin_resultado" }),
      proposed({
        type: "inconsistencia",
        ref: { section: "experience", itemId: JOB_OLD, field: "dates" },
      }),
      proposed({
        type: "orden_poco_relevante",
        ref: { section: "experience", itemId: null, field: "order" },
      }),
    ];
    const a = buildCvDiagnosis(ctx, list);
    const b = buildCvDiagnosis(ctx, [...list].reverse());
    expect(b).toEqual(a);
  });

  it(`hasta ${CV_COACH_MAX_ISSUES_PER_ITEM} por ítem y ${CV_COACH_MAX_ISSUES} en total`, () => {
    const types = [
      "logro_sin_resultado",
      "tarea_vaga",
      "vineta_sin_verbo",
      "inconsistencia",
    ] as const;
    const many = [JOB_NOW, JOB_OLD, PROJECT].flatMap((itemId) =>
      types.map((type) =>
        proposed({
          type,
          ref: {
            section: itemId === PROJECT ? "projects" : "experience",
            itemId,
            field: "bullets",
          },
        }),
      ),
    );
    many.push(
      proposed({
        type: "orden_poco_relevante",
        ref: { section: "experience", itemId: null, field: "order" },
      }),
    );
    const out = buildCvDiagnosis(ctx, many);
    expect(out.length).toBe(CV_COACH_MAX_ISSUES);
    const perItem = new Map<string, number>();
    for (const i of out) {
      const k = `${i.ref.section}:${i.ref.itemId}`;
      perItem.set(k, (perItem.get(k) ?? 0) + 1);
    }
    expect(Math.max(...perItem.values())).toBeLessThanOrEqual(CV_COACH_MAX_ISSUES_PER_ITEM);
    expect(out.map((i) => i.id)).toEqual(out.map((_, n) => `iss:${n + 1}`));
    for (const i of out) expect(cvIssueSchema.safeParse(i).success).toBe(true);
  });

  it("dos propuestas iguales quedan una, con la severidad más alta", () => {
    const out = buildCvDiagnosis({ ...ctx, demand: [] }, [
      proposed({ severity: "baja" }),
      proposed({ severity: "alta" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("alta");
  });

  it("sin salida del modelo (null) quedan solo las brechas de datos", () => {
    expect(buildCvDiagnosis(ctx, null).every((i) => i.source === "data")).toBe(true);
  });
});

describe("revalidación de la lista firmada contra la base", () => {
  it("descarta problemas de ítems borrados y citas que ya no están", () => {
    const list = buildCvDiagnosis(ctx, [
      proposed({ quote: "Automaticé tableros de ventas" }),
      proposed({
        type: "tarea_vaga",
        ref: { section: "experience", itemId: JOB_OLD, field: "bullets" },
      }),
    ]);
    const edited = items
      .filter((i) => i.id !== JOB_OLD)
      .map((i) => (i.id === JOB_NOW ? { ...i, bullets: ["Otra cosa"] } : i));
    const out = revalidateCvIssues(list, { ...ctx, items: edited });
    expect(out.some((i) => i.ref.itemId === JOB_OLD)).toBe(false);
    expect(out.find((i) => i.ref.itemId === JOB_NOW)?.quote).toBeNull();
    // las brechas de skills siguen (apuntan a la taxonomía)
    expect(out.some((i) => i.type === "brecha_con_puesto")).toBe(true);
    // conserva los ids: el navegador los usa para el avance
    expect(out.map((i) => i.id)).toEqual(
      list.filter((i) => i.ref.itemId !== JOB_OLD).map((i) => i.id),
    );
  });
});
