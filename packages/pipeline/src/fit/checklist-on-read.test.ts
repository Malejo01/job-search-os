import { describe, expect, it } from "vitest";
import criteria from "../../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "../criteria";
import type { Evaluation } from "../evaluation";
import { compileTaxonomy, type Term } from "../skills/match";
import {
  checklistOnRead,
  type ChecklistOnReadContext,
  type StoredEvaluation,
} from "./checklist-on-read";

// Fixtures inventadas: aviso, empresa y perfil ficticios, sin datos de nadie
const rules = criteria as CriteriaRules;

const terms = compileTaxonomy([
  { slug: "python", name: "Python", aliases: [] },
  { slug: "docker", name: "Docker", aliases: [] },
  { slug: "kotlin", name: "Kotlin", aliases: [] },
]);

/** JSON del modelo tal como queda en `evaluations.raw`. */
const raw: Evaluation = {
  score: 6,
  confianza: "media",
  years_required: 8,
  location_ok: "ok",
  modalidad: "hibrido",
  disciplina: "backend",
  ingles_requerido: "avanzado",
  tipo_empresa: "producto",
  paises_permitidos: ["AR", "UY"],
  match_fuerte: ["Python"],
  gaps: [{ skill: "Kotlin", nivel: "must" }],
  bloqueadores_duros: [],
  senales_positivas: [],
  veredicto: "Aviso de prueba de Empresa Ficticia SA.",
  accion_sugerida: "guardar",
  riesgos: [],
  years_domain: null,
  years_discipline: null,
};

const stored = (over: Partial<StoredEvaluation> = {}): StoredEvaluation => ({
  raw,
  score: 5.5,
  scoreModel: 6,
  accion: "guardar",
  bloqueadoresDuros: [],
  riesgos: [],
  locationOk: "ok",
  hadFullJd: true,
  adjustments: [],
  ...over,
});

const ctx = (over: Partial<ChecklistOnReadContext["job"]> = {}): ChecklistOnReadContext => ({
  profile: {
    yearsTotal: 4,
    englishCefr: "B1",
    locationCountry: "AR",
    workAuth: { us: false, eu: false },
    acceptedModalities: ["remoto"],
  },
  job: {
    title: "Backend ficticio",
    jdText: "Buscamos backend con Python, Docker y Kotlin para Empresa Ficticia SA.",
    countriesAllowed: ["AR", "UY"],
    salaryMinUsd: 2000,
    salaryMaxUsd: 2500,
    salaryPeriod: "mensual",
    salaryFromApi: true,
    weeklyHours: 45,
    ...over,
  },
  skillLevels: new Map([
    ["python", 3],
    ["kotlin", 1],
  ]),
  userSkills: [],
  terms,
});

const byId = (c: ReturnType<typeof checklistOnRead>, id: string) =>
  c?.items.find((i) => i.id === id);

describe("checklistOnRead: falla cerrado", () => {
  it("raw que no es una evaluación (fila del golden, null, basura) → null", () => {
    expect(checklistOnRead(stored({ raw: null }), rules, ctx())).toBeNull();
    expect(checklistOnRead(stored({ raw: "texto" }), rules, ctx())).toBeNull();
    expect(
      checklistOnRead(stored({ raw: { titulo: "Puesto ficticio", empresa: "X" } }), rules, ctx()),
    ).toBeNull();
    // Le falta un campo obligatorio: nada de extracción parcial
    const { modalidad: _m, ...sinModalidad } = raw;
    expect(checklistOnRead(stored({ raw: sinModalidad }), rules, ctx())).toBeNull();
  });

  it("columnas guardadas con forma inválida → null", () => {
    expect(checklistOnRead(stored({ locationOk: "quizas" }), rules, ctx())).toBeNull();
    expect(checklistOnRead(stored({ accion: "postular_ya" }), rules, ctx())).toBeNull();
    expect(checklistOnRead(stored({ adjustments: "no es lista" }), rules, ctx())).toBeNull();
  });

  it("si buildChecklist tira, null", () => {
    const broken = {
      slug: "roto",
      term: "roto",
      get re(): RegExp {
        throw new Error("taxonomía rota");
      },
    } as Term;
    expect(checklistOnRead(stored(), rules, { ...ctx(), terms: [broken] })).toBeNull();
  });

  it("sin adjustments guardados (evaluación vieja) se toma como lista vacía", () => {
    expect(checklistOnRead(stored({ adjustments: undefined }), rules, ctx())).not.toBeNull();
    expect(checklistOnRead(stored({ adjustments: null }), rules, ctx())).not.toBeNull();
  });
});

describe("checklistOnRead: solo la parte determinista", () => {
  const c = checklistOnRead(stored(), rules, ctx());

  it("saca los ítems cuyo «pide» viene del modelo y los de texto", () => {
    expect(c).not.toBeNull();
    for (const id of ["modalidad", "disciplina", "anos", "ingles"]) {
      expect(byId(c, id)).toBeUndefined();
    }
    expect(c!.items.every((i) => i.fuente.pide === "fuente" && i.kind !== "texto")).toBe(true);
  });

  it("deja país, salario, jornada y las skills nombradas", () => {
    expect(byId(c, "pais")).toMatchObject({ status: "cumple", tenes: "AR" });
    expect(byId(c, "salario")).toMatchObject({ status: "no_cumple" });
    expect(byId(c, "jornada")).toMatchObject({ status: "no_cumple", tenes: "Máximo 40 h" });
  });

  it("skill del perfil que cumple y una que falta; la que no tiene nivel queda sin saber", () => {
    expect(byId(c, "skill:python")).toMatchObject({
      status: "cumple",
      tenes: "Nivel 3 de 3",
      fuente: { pide: "fuente", tenes: "skills" },
    });
    expect(byId(c, "skill:kotlin")).toMatchObject({ status: "no_cumple", tenes: "Nivel 1 de 3" });
    expect(byId(c, "skill:docker")).toMatchObject({ status: "no_se_sabe", tenes: null });
  });

  it("recalcula los conteos sobre lo que quedó (las skills no entran al titular)", () => {
    expect(c!.must).toEqual({ cumple: 1, no_cumple: 2, no_se_sabe: 0 });
    expect(c!.deseable).toEqual({ cumple: 0, no_cumple: 0, no_se_sabe: 0 });
  });

  it("siempre parcial, aunque la evaluación tuviera la JD completa", () => {
    expect(c!.parcial).toBe(true);
  });

  it("descarte rápido: el original si sigue en la lista", () => {
    // En el completo el primero es «modalidad» (del modelo, sale); sin él, null
    expect(c!.descarte_rapido).toBeNull();
    const remoto = checklistOnRead(
      stored({
        raw: { ...raw, modalidad: "remoto", ingles_requerido: "no_menciona", years_required: null },
      }),
      rules,
      ctx({ jdText: null }),
    );
    // Sin ítems del modelo que no cumplan, el primero es el salario y sigue en la lista
    expect(remoto?.descarte_rapido?.id).toBe("salario");
    expect(remoto?.items).toContainEqual(remoto?.descarte_rapido);
  });

  it("la ubicación sale de la columna guardada (location_ok efectivo), no del raw", () => {
    const c2 = checklistOnRead(stored({ locationOk: "no" }), rules, ctx());
    expect(byId(c2, "pais")).toMatchObject({ status: "no_cumple" });
  });
});
