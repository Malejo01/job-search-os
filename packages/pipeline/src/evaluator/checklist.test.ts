import { describe, expect, it } from "vitest";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import { decide, type DecideContext } from "../decide";
import type { Evaluation } from "../evaluation";
import { compileTaxonomy } from "../skills/match";
import { MAX_JD_CHARS } from "../pool/career/english";
import {
  buildChecklist,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_TEXT_MAX,
  type ChecklistContext,
} from "./checklist";

const rules = criteria as CriteriaRules;

const terms = compileTaxonomy([
  { slug: "python", name: "Python", aliases: [] },
  { slug: "docker", name: "Docker", aliases: [] },
  { slug: "angular", name: "Angular", aliases: [] },
  { slug: "english_fluent", name: "English fluent", aliases: ["fluent english"] },
]);

const base: Evaluation = {
  score: 8,
  confianza: "alta",
  years_required: 3,
  location_ok: "ok",
  modalidad: "remoto",
  disciplina: "ai_engineer",
  ingles_requerido: "no_menciona",
  tipo_empresa: "producto",
  paises_permitidos: ["AR"],
  match_fuerte: [],
  gaps: [],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "ok",
  accion_sugerida: "aplicar",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

const ctxBase = (over: Partial<ChecklistContext["job"]> = {}): ChecklistContext => ({
  profile: {
    yearsTotal: 5,
    englishCefr: "B2",
    locationCountry: "AR",
    workAuth: { us: false, eu: false },
    acceptedModalities: ["remoto"],
  },
  job: { hadFullJd: true, jdText: null, ...over },
  skillLevels: new Map([
    ["python", 2],
    ["angular", 1],
  ]),
  userSkills: [],
  terms,
});

const run = (ev: Evaluation, ctx: ChecklistContext, dctx: DecideContext = {}) => {
  const d = decide(ev, rules, {
    candidateEnglishCefr: ctx.profile.englishCefr,
    candidateYearsTotal: ctx.profile.yearsTotal,
    acceptedModalities: ["remoto"],
    jobFacts: ctx.job,
    ...dctx,
  });
  return { d, c: buildChecklist(ev, d, rules, ctx) };
};
const byId = (c: ReturnType<typeof buildChecklist>, id: string) => c.items.find((i) => i.id === id);

describe("buildChecklist: golden 35 (otro oficio, JD completa)", () => {
  const ev: Evaluation = {
    ...base,
    disciplina: "creative_production",
    years_required: 3,
    years_domain: "publicidad",
    years_discipline: "creative_production",
    ingles_requerido: "avanzado",
    bloqueadores_duros: [],
  };
  const { d, c } = run(ev, ctxBase({ jdText: "Strong written English. Python." }));

  it("disciplina y años en otro oficio: no cumplen y bloquean", () => {
    expect(byId(c, "disciplina")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(byId(c, "anos")).toMatchObject({ status: "no_cumple", bloquea: true, tenes: "5 años" });
    expect(d.accion).toBe("descartar");
  });
  it("inglés avanzado contra B2: no cumple y no bloquea; conteo de must", () => {
    expect(byId(c, "ingles")).toMatchObject({ status: "no_cumple", bloquea: false, tenes: "B2" });
    expect(c.must).toEqual({ cumple: 2, no_cumple: 3, no_se_sabe: 0 });
    expect(c.parcial).toBe(false);
  });
  it("descarte rápido: el oficio va antes que los años y el inglés", () => {
    expect(c.descarte_rapido?.id).toBe("disciplina");
  });
});

describe("buildChecklist: golden 19 (salario bajo el piso, jornada del modelo)", () => {
  const ev: Evaluation = { ...base, bloqueadores_duros: ["Jornada indefinida de 48 hs"] };
  const { d, c } = run(
    ev,
    ctxBase({ salaryMinUsd: 2400, salaryMaxUsd: 2800, salaryPeriod: "mensual" }),
  );
  it("salario bloquea desde el código y la jornada del modelo también", () => {
    expect(byId(c, "salario")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(byId(c, "salario")?.tenes).toContain("3000");
    expect(byId(c, "jornada")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(d.bloqueadores).toHaveLength(2);
  });
  it("descarte rápido: el salario antes que la jornada", () => {
    expect(c.descarte_rapido?.id).toBe("salario");
  });
});

describe("buildChecklist: golden 33 (salario por hora)", () => {
  const ev: Evaluation = { ...base, ingles_requerido: "avanzado" };
  const { c } = run(
    ev,
    ctxBase({
      salaryMinUsd: 100,
      salaryMaxUsd: 150,
      salaryPeriod: "hora",
      jdText: "Fluent english needed.",
    }),
  );
  it("por hora: no se sabe, sin bloqueo", () => {
    expect(byId(c, "salario")).toMatchObject({ status: "no_se_sabe", bloquea: false });
  });
  it("inglés avanzado contra B2: no cumple", () => {
    expect(byId(c, "ingles")?.status).toBe("no_cumple");
    expect(c.descarte_rapido?.id).toBe("ingles");
  });
});

describe("buildChecklist: golden 29 (USD pagado en moneda local)", () => {
  const { d, c } = run(
    base,
    ctxBase({ salaryMaxUsd: 7000, salaryPeriod: "mensual", salaryNote: "pagado en ARS" }),
  );
  it("el salario cumple y la moneda local es riesgo, no ítem bloqueante", () => {
    expect(byId(c, "salario")).toMatchObject({ status: "cumple", bloquea: false });
    expect(d.riesgos).toContain("salario en USD pagado en moneda local");
    expect(c.descarte_rapido).toBeNull();
  });
});

describe("buildChecklist: salario leído del texto del aviso (S-O4, ronda 109)", () => {
  const salary = { salaryMinUsd: 2400, salaryMaxUsd: 2800, salaryPeriod: "mensual" };
  it("de la API: no cumple y bloquea, sin nota", () => {
    const { d, c } = run(base, ctxBase({ ...salary, salaryFromApi: true }));
    expect(byId(c, "salario")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(byId(c, "salario")?.nota).toBeUndefined();
    expect(d.bloqueadores).toHaveLength(1);
  });
  it("del texto: no se sabe, no bloquea y lleva la nota", () => {
    const { d, c } = run(base, ctxBase({ ...salary, salaryFromApi: false }));
    expect(byId(c, "salario")).toMatchObject({
      status: "no_se_sabe",
      bloquea: false,
      nota: "salario leído del texto del aviso",
    });
    expect(d.bloqueadores).toEqual([]);
    expect(c.descarte_rapido).toBeNull();
  });
  it("del texto con el bloqueador de salario del modelo: el ítem sigue siendo «no se sabe» pero bloquea", () => {
    const ev: Evaluation = { ...base, bloqueadores_duros: ["Salario bajo el piso"] };
    const { c } = run(ev, ctxBase({ ...salary, salaryFromApi: false }));
    expect(byId(c, "salario")).toMatchObject({ status: "no_se_sabe", bloquea: true });
  });
});

describe("buildChecklist: golden 2 (junior, presencial, fase A)", () => {
  const ev: Evaluation = {
    ...base,
    modalidad: "presencial",
    bloqueadores_duros: ["Modalidad presencial"],
    years_required: 1,
  };
  const { d, c } = run(ev, ctxBase(), {
    jobFacts: { title: "Desarrollador Fullstack Junior" },
  });
  it("modalidad no aceptada bloquea; el seniority del título es riesgo, no ítem", () => {
    expect(byId(c, "modalidad")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(d.riesgos.some((r) => /es junior/.test(r))).toBe(true);
    expect(c.items.some((i) => /seniority/.test(i.id))).toBe(false);
    expect(c.descarte_rapido?.id).toBe("modalidad");
  });
});

describe("buildChecklist: skills que nombra el aviso", () => {
  const jd = "Buscamos Python, Docker y Angular. Fluent english. Conocimientos de Rust.";
  const { c } = run(base, ctxBase({ jdText: jd }));
  const skills = c.items.filter((i) => i.kind === "skill");

  it("cruza job_skills con skill_levels y no incluye english_*", () => {
    expect(skills.map((s) => [s.id, s.status])).toEqual([
      ["skill:python", "cumple"],
      ["skill:docker", "no_se_sabe"],
      ["skill:angular", "no_cumple"],
    ]);
    expect(skills[0]).toMatchObject({
      nivel: "deseable",
      fuente: { pide: "fuente", tenes: "skills" },
      evidencia: null,
    });
    expect(skills[1]?.fuente.tenes).toBeNull();
  });
  it("no entran al X de Y", () => {
    expect(c.must.cumple + c.deseable.cumple).toBe(
      c.items.filter((i) => i.kind !== "skill" && i.status === "cumple").length,
    );
    expect(c.deseable).toEqual({ cumple: 0, no_cumple: 0, no_se_sabe: 0 });
  });
  it("respaldo por user_skills por nombre", () => {
    const ctx = { ...ctxBase({ jdText: "Docker" }), userSkills: [{ name: "docker", level: 3 }] };
    expect(byId(run(base, ctx).c, "skill:docker")?.status).toBe("cumple");
  });
});

describe("buildChecklist: parcial e inglés en avisos en español", () => {
  it("parcial cuando no hay JD completa", () => {
    expect(run(base, ctxBase({ hadFullJd: false })).c.parcial).toBe(true);
  });
  it("aviso en español que no pide inglés: el ítem inglés no aparece", () => {
    const jdEs =
      "Buscamos una persona desarrolladora para sumarse a nuestro equipo de producto. Vas a trabajar con Python y APIs, de manera remota, con un horario flexible. Ofrecemos capacitación continua y un buen clima laboral.";
    const { c } = run({ ...base, ingles_requerido: "avanzado" }, ctxBase({ jdText: jdEs }));
    expect(byId(c, "ingles")).toBeUndefined();
  });
  it("sin años del perfil: no se sabe", () => {
    const ctx = ctxBase();
    ctx.profile.yearsTotal = null;
    expect(byId(run(base, ctx).c, "anos")).toMatchObject({ status: "no_se_sabe", tenes: null });
  });
  it("residencia exigida: ítem que bloquea", () => {
    const { c } = run(base, ctxBase(), { prefilterFlags: ["residencia_exigida:CA"] });
    expect(byId(c, "residencia")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(c.descarte_rapido?.id).toBe("residencia");
  });
});

describe("buildChecklist: país coherente con decide()", () => {
  it("el modelo dice ok pero hay residencia exigida: país no sale «cumple»", () => {
    const { d, c } = run(base, ctxBase(), { prefilterFlags: ["residencia_exigida:CA"] });
    expect(d.locationOk).toBe("no");
    expect(byId(c, "pais")?.status).toBe("no_cumple");
  });
  it("sin residencia exigida sigue valiendo lo que dice la decisión", () => {
    expect(byId(run(base, ctxBase()).c, "pais")?.status).toBe("cumple");
  });
});

describe("buildChecklist: piso y jornada salen de rules, como en decide()", () => {
  it("el piso es rules.salary_floor_usd_monthly", () => {
    const strict = { ...rules, salary_floor_usd_monthly: 5000 } as CriteriaRules;
    const ctx = ctxBase({ salaryMaxUsd: 4000, salaryPeriod: "mensual" });
    const d = decide(base, strict, { jobFacts: ctx.job });
    const c = buildChecklist(base, d, strict, ctx);
    expect(byId(c, "salario")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(byId(c, "salario")?.tenes).toContain("5000");
  });
  it("la jornada máxima es rules.max_weekly_hours", () => {
    const strict = { ...rules, max_weekly_hours: 30 } as CriteriaRules;
    const ctx = ctxBase({ weeklyHours: 35 });
    const d = decide(base, strict, { jobFacts: ctx.job });
    const c = buildChecklist(base, d, strict, ctx);
    expect(byId(c, "jornada")).toMatchObject({ status: "no_cumple", bloquea: true });
    expect(byId(c, "jornada")?.tenes).toContain("30");
  });
  it("el contexto del perfil no lleva piso ni jornada", () => {
    expect(Object.keys(ctxBase().profile)).not.toContain("salaryFloorUsd");
    expect(Object.keys(ctxBase().profile)).not.toContain("maxWeeklyHours");
  });
});

describe("buildChecklist: moneda local", () => {
  it("máximo en USD bajo el piso: bloquea aunque la nota hable de moneda local", () => {
    const { d, c } = run(
      base,
      ctxBase({ salaryMaxUsd: 2000, salaryPeriod: "mensual", salaryNote: "pagado en ARS" }),
    );
    expect(d.bloqueadores.some((b) => /por debajo del piso/.test(b))).toBe(true);
    expect(byId(c, "salario")).toMatchObject({ status: "no_cumple", bloquea: true });
  });
  it("máximo sobre el piso: la moneda local es solo riesgo", () => {
    const { d, c } = run(
      base,
      ctxBase({ salaryMaxUsd: 7000, salaryPeriod: "mensual", salaryNote: "pagado en ARS" }),
    );
    expect(d.bloqueadores).toEqual([]);
    expect(d.riesgos).toContain("salario en USD pagado en moneda local");
    expect(byId(c, "salario")?.bloquea).toBe(false);
  });
});

describe("buildChecklist: topes de largo", () => {
  const bigTerms = compileTaxonomy(
    Array.from({ length: 60 }, (_, i) => ({
      slug: `tec${i}x`,
      name: `Tecnologia${i}x`,
      aliases: [],
    })),
  );

  it("texto enorme de repeticiones: termina rápido y lo que pasa del tope se ignora", () => {
    const jd = `${"python ".repeat(400_000)} docker`;
    const t0 = Date.now();
    const { c } = run(base, ctxBase({ jdText: jd }));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(jd.length).toBeGreaterThan(MAX_JD_CHARS);
    expect(byId(c, "skill:python")).toBeDefined();
    expect(byId(c, "skill:docker")).toBeUndefined();
  });

  it("40 países y 60 skills: el checklist cabe en los topes de lectura de la web", () => {
    const countries = Array.from({ length: 40 }, (_, i) => `Pais${i}`);
    const jd = Array.from({ length: 60 }, (_, i) => `Tecnologia${i}x`).join(", ");
    const ctx = { ...ctxBase({ jdText: jd }), terms: bigTerms };
    const longAuth = `visa de trabajo de EEUU ${"muy larga ".repeat(80)}`;
    const ev = { ...base, paises_permitidos: countries, bloqueadores_duros: [longAuth] };
    const { c } = run(ev, ctx);
    expect(c.items.filter((i) => i.kind === "skill")).toHaveLength(20);
    expect(c.items.length).toBeLessThanOrEqual(CHECKLIST_MAX_ITEMS);
    // El zod de apps/web/lib/job-detail.ts acepta pide/tenes hasta 200 caracteres
    for (const it of c.items) {
      expect(it.pide.length).toBeLessThanOrEqual(CHECKLIST_TEXT_MAX);
      expect((it.tenes ?? "").length).toBeLessThanOrEqual(CHECKLIST_TEXT_MAX);
    }
    expect(byId(c, "pais")?.pide).toBe("Disponible en Pais0, Pais1, Pais2, Pais3, Pais4 y 35 más");
    expect(byId(c, "autorizacion")?.pide.endsWith("…")).toBe(true);
  });
});
