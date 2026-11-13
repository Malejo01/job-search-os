import { describe, expect, it } from "vitest";
import abogacia from "../test/fixtures/criterios-carreras/abogacia.json";
import administracion from "../test/fixtures/criterios-carreras/administracion_empresas.json";
import comunicacion from "../test/fixtures/criterios-carreras/comunicacion.json";
import finanzas from "../test/fixtures/criterios-carreras/finanzas_contabilidad.json";
import fullstack from "../test/fixtures/criterios-carreras/fullstack.json";
import marketing from "../test/fixtures/criterios-carreras/marketing_digital.json";
import relacionesInternacionales from "../test/fixtures/criterios-carreras/relaciones_internacionales.json";
import relacionesPublicas from "../test/fixtures/criterios-carreras/relaciones_publicas.json";
import { decide } from "./decide";
import { DISCIPLINES, type Evaluation } from "./evaluation";
import {
  CAREER_DISCIPLINES,
  criteriaFromOnboarding,
  DEFAULT_CRITERIA_RULES,
  disciplinesForRoles,
} from "./onboarding";
import { BETA_LAUNCH_ROLE_KEYS, defaultRole, type RoleKey } from "./skills/self-assessment";

/**
 * R6-2: los criterios de una persona nueva salen de su carrera. Fixtures inventadas (empresas
 * ficticias) de las 8 carreras de la beta. La disciplina de cada aviso es la que el evaluador
 * escribiría: las de la v1.3 (`otra`, `negocio`...) o, desde R6-2, las propias de la carrera.
 */
type Aviso = { empresa: string; titulo: string; disciplina: string };
type Fixture = { carrera: string; propios: Aviso[]; ajenos: Aviso[] };

const FIXTURES = [
  abogacia,
  finanzas,
  administracion,
  comunicacion,
  marketing,
  relacionesPublicas,
  relacionesInternacionales,
  fullstack,
] as Fixture[];

const NEW_DISCIPLINES = [
  "abogacia",
  "finanzas_contabilidad",
  "comunicacion",
  "relaciones_internacionales",
  "relaciones_publicas",
];

const evaluation = (disciplina: string, extra: Partial<Evaluation> = {}): Evaluation =>
  ({
    score: 8,
    confianza: "alta",
    years_required: null,
    location_ok: "ok",
    modalidad: "remoto",
    disciplina,
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
    ...extra,
  }) as Evaluation;

const rulesFor = (...roles: RoleKey[]) =>
  criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null, targetRoles: roles });

describe("DISCIPLINES: las carreras que faltaban", () => {
  it("suma abogacía, contaduría, comunicación, RR.II. y RR.PP. después de las 19", () => {
    expect(DISCIPLINES).toHaveLength(24);
    expect(DISCIPLINES.slice(19)).toEqual(NEW_DISCIPLINES);
  });
});

describe("criteriaFromOnboarding con la carrera elegida", () => {
  it("cubre las 8 carreras de la beta con un fixture", () => {
    expect(FIXTURES.map((f) => f.carrera).sort()).toEqual([...BETA_LAUNCH_ROLE_KEYS].sort());
  });

  it("las disciplinas permitidas de cada carrera no listan las técnicas (salvo programación)", () => {
    const tech = [
      "ai_engineer",
      "ml_engineer",
      "backend",
      "frontend",
      "devops",
      "data",
      "fullstack",
    ];
    for (const role of BETA_LAUNCH_ROLE_KEYS.filter((r) => r !== "fullstack")) {
      const allowed = rulesFor(role).allowed_disciplines;
      expect(allowed.length, role).toBeGreaterThan(0);
      // Contaduría y administración sí listan `data`: un analista con Excel y SQL llega etiquetado así
      const withData = role === "finanzas_contabilidad" || role === "administracion_empresas";
      for (const d of tech) {
        if (d === "data" && withData) continue;
        expect(allowed, `${role} lista ${d}`).not.toContain(d);
      }
      // Siempre incluye `otra` y `negocio`: el modelo (v1.3) no tiene disciplina propia para el oficio
      expect(allowed, role).toContain("otra");
      expect(allowed, role).toContain("negocio");
      for (const d of allowed) expect(DISCIPLINES as readonly string[]).toContain(d);
    }
  });

  it("cada carrera lista su propia disciplina cuando existe", () => {
    for (const role of NEW_DISCIPLINES) {
      expect(rulesFor(role as RoleKey).allowed_disciplines).toContain(role);
    }
    expect(rulesFor("marketing_digital").allowed_disciplines).toContain("marketing_digital");
  });

  it("programación no cambia: queda con todas las disciplinas, igual que sin carrera", () => {
    expect(rulesFor("fullstack")).toEqual(DEFAULT_CRITERIA_RULES);
    expect(rulesFor("backend", "ai_engineer")).toEqual(DEFAULT_CRITERIA_RULES);
  });

  it("sin carrera (ausente o vacía) no cambia nada", () => {
    expect(criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null })).toEqual(
      DEFAULT_CRITERIA_RULES,
    );
    expect(rulesFor()).toEqual(DEFAULT_CRITERIA_RULES);
  });

  it("solo cambian las disciplinas: el resto de las reglas sigue siendo el default", () => {
    const { allowed_disciplines: _a, ...rest } = rulesFor("abogacia");
    const { allowed_disciplines: _b, ...defaults } = DEFAULT_CRITERIA_RULES;
    expect(rest).toEqual(defaults);
  });

  it("el piso salarial y las horas del formulario se conservan", () => {
    expect(
      criteriaFromOnboarding({
        salaryFloorUsd: 1500,
        maxWeeklyHours: 30,
        targetRoles: ["abogacia"],
      }),
    ).toMatchObject({ salary_floor_usd_monthly: 1500, max_weekly_hours: 30 });
  });

  it("varias carreras: unión en el orden canónico", () => {
    const union = rulesFor("abogacia", "comunicacion").allowed_disciplines;
    expect(union).toEqual([...DISCIPLINES].filter((d) => union.includes(d)));
    expect(union).toEqual(
      expect.arrayContaining([
        ...CAREER_DISCIPLINES.abogacia!,
        ...CAREER_DISCIPLINES.comunicacion!,
      ]),
    );
  });

  it("una carrera sin criterios propios (programación) junto a otra no acota: manda lo conservador", () => {
    expect(rulesFor("abogacia", "fullstack")).toEqual(DEFAULT_CRITERIA_RULES);
    expect(disciplinesForRoles(["abogacia", "fullstack"])).toBeNull();
  });

  it("no comparte el arreglo con el default (mutar uno no cambia el otro)", () => {
    const rules = rulesFor("abogacia");
    rules.allowed_disciplines.push("backend");
    expect(CAREER_DISCIPLINES.abogacia).not.toContain("backend");
    expect(DEFAULT_CRITERIA_RULES.allowed_disciplines).toHaveLength(DISCIPLINES.length);
  });
});

describe("decide() con los criterios de cada carrera", () => {
  for (const fx of FIXTURES) {
    describe(fx.carrera, () => {
      const rules = rulesFor(fx.carrera as RoleKey);

      it("no descarta los avisos de su carrera por disciplina", () => {
        for (const a of fx.propios) {
          const d = decide(evaluation(a.disciplina), rules);
          expect(d.bloqueadores, a.titulo).toEqual([]);
          expect(d.accion, a.titulo).toBe("aplicar");
          expect(d.scoreFinal, a.titulo).toBe(8);
        }
      });

      it("si el modelo escribió «disciplina distinta» sobre un aviso propio, se cae", () => {
        for (const a of fx.propios) {
          const d = decide(
            evaluation(a.disciplina, { bloqueadores_duros: ["disciplina distinta (otra)"] }),
            rules,
          );
          expect(d.bloqueadores, a.titulo).toEqual([]);
        }
      });

      it("marca los avisos de otra disciplina", () => {
        for (const a of fx.ajenos) {
          const d = decide(evaluation(a.disciplina), rules);
          expect(d.bloqueadores, a.titulo).toEqual([`disciplina distinta (${a.disciplina})`]);
          expect(d.accion, a.titulo).toBe("descartar");
          expect(d.scoreFinal, a.titulo).toBeLessThanOrEqual(rules.discipline_cap_score ?? 10);
        }
      });
    });
  }

  it("«Desarrollador backend» para abogacía se marca; para programación no", () => {
    const backend = evaluation("backend");
    expect(decide(backend, rulesFor("abogacia")).bloqueadores).toEqual([
      "disciplina distinta (backend)",
    ]);
    expect(decide(backend, rulesFor("fullstack")).bloqueadores).toEqual([]);
  });

  it("un analista financiero etiquetado «data» no se descarta para contaduría ni administración, ni por años", () => {
    for (const role of ["finanzas_contabilidad", "administracion_empresas"] as const) {
      const d = decide(
        evaluation("data", {
          years_required: 2,
          years_discipline: "data",
          years_domain: "Excel y SQL",
        }),
        rulesFor(role),
      );
      expect(d.bloqueadores, role).toEqual([]);
      expect(d.accion, role).toBe("aplicar");
    }
    // Para abogacía sigue siendo otro oficio
    expect(decide(evaluation("data"), rulesFor("abogacia")).bloqueadores).toEqual([
      "disciplina distinta (data)",
    ]);
  });

  it("los años de otro oficio también cuentan contra la carrera", () => {
    const d = decide(
      evaluation("otra", {
        years_required: 3,
        years_discipline: "backend",
        years_domain: "backend",
      }),
      rulesFor("abogacia"),
    );
    expect(d.bloqueadores).toEqual(["años en otro dominio (backend)"]);
  });
});

describe("defaultRole con los criterios por carrera", () => {
  it("devuelve la carrera cuando las disciplinas la identifican", () => {
    const roleOf = (role: RoleKey) =>
      defaultRole({
        headline: null,
        allowedDisciplines: rulesFor(role).allowed_disciplines,
        defaultDisciplines: DEFAULT_CRITERIA_RULES.allowed_disciplines,
      });
    expect(roleOf("abogacia")).toBe("abogacia");
    expect(roleOf("finanzas_contabilidad")).toBe("finanzas_contabilidad");
    expect(roleOf("comunicacion")).toBe("comunicacion");
    expect(roleOf("relaciones_publicas")).toBe("relaciones_publicas");
    expect(roleOf("relaciones_internacionales")).toBe("relaciones_internacionales");
    expect(roleOf("marketing_digital")).toBe("marketing_digital");
  });

  it("los criterios de fábrica de antes (19 disciplinas) siguen sin sugerir un puesto", () => {
    expect(
      defaultRole({
        headline: null,
        allowedDisciplines: DISCIPLINES.slice(0, 19),
        defaultDisciplines: DEFAULT_CRITERIA_RULES.allowed_disciplines,
      }),
    ).toBeNull();
  });
});
