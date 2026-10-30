import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../evaluator/checklist";
import {
  blockerInPlainSpanish,
  buildFitPoints,
  FIT_POINTS_MAX,
  summarizeFitCard,
  type FitPointsInput,
} from "./fit-points";

const item = (over: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "pide" | "status">) =>
  ({
    kind: "estructurado",
    nivel: "must",
    evidencia: null,
    tenes: null,
    fuente: { pide: "fuente", tenes: "perfil" },
    bloquea: false,
    ...over,
  }) as ChecklistItem;

const empty: FitPointsInput = {
  matchFuerte: [],
  senales: [],
  gaps: [],
  riesgos: [],
  bloqueadores: [],
};

describe("buildFitPoints", () => {
  it("sin datos: dos listas vacías", () => {
    expect(buildFitPoints(empty)).toEqual({ favor: [], falta: [] });
  });

  it("a tu favor: requisitos que cumplís, después el match y las señales, sin repetir", () => {
    const r = buildFitPoints({
      ...empty,
      matchFuerte: ["TypeScript", "typescript", "APIs"],
      senales: ["Pocos candidatos"],
      checklist: {
        items: [
          item({ id: "pais", pide: "Disponible en AR", status: "cumple" }),
          item({ id: "ingles", pide: "Inglés intermedio", status: "cumple" }),
        ],
      },
    });
    expect(r.favor.map((p) => p.text)).toEqual([
      "TypeScript",
      "APIs",
      "Podés trabajar desde tu país",
      "Tu inglés alcanza",
      "Pocos candidatos",
    ]);
    expect(r.favor.map((p) => p.kind)).toEqual(["match", "match", "cumple", "cumple", "senal"]);
  });

  it("máximo 5 por lista", () => {
    const many = Array.from({ length: 9 }, (_, i) => `Cosa número ${i + 1}`);
    const r = buildFitPoints({ ...empty, matchFuerte: many, gaps: many });
    expect(r.favor).toHaveLength(FIT_POINTS_MAX);
    expect(r.falta).toHaveLength(FIT_POINTS_MAX);
  });

  it("te falta o te frena: bloqueadores primero, después lo que no cumplís, gaps, riesgos y datos que faltan", () => {
    const r = buildFitPoints({
      ...empty,
      bloqueadores: ["años requeridos ≥ 8 (10)"],
      gaps: ["Kafka"],
      riesgos: ["salario no publicado"],
      checklist: {
        items: [
          item({ id: "ingles", pide: "Inglés avanzado", tenes: "B1", status: "no_cumple" }),
          item({ id: "jornada", pide: "40 h semanales", status: "no_se_sabe" }),
        ],
      },
    });
    expect(r.falta).toEqual([
      { kind: "frena", text: "Piden 10 años de experiencia, más de lo que admite tu búsqueda" },
      { kind: "falta", text: "Piden inglés avanzado, más de tu nivel" },
      { kind: "falta", text: "Kafka" },
      { kind: "ojo", text: "Salario no publicado" },
      { kind: "sin_dato", text: "tus horas máximas por semana (completalo en tu perfil)" },
    ]);
  });

  it("el ítem del checklist que ya frena no se repite si hay un bloqueador", () => {
    const r = buildFitPoints({
      ...empty,
      bloqueadores: ["aviso limitado a CA (no incluye tu país)"],
      checklist: {
        items: [item({ id: "pais", pide: "Disponible en CA", status: "no_cumple", bloquea: true })],
      },
    });
    expect(r.falta).toEqual([
      { kind: "frena", text: "El aviso es solo para CA y no incluye tu país" },
    ]);
  });

  it("un requisito que frena sin bloqueador guardado se muestra como «frena»", () => {
    const r = buildFitPoints({
      ...empty,
      checklist: {
        items: [item({ id: "pais", pide: "Disponible en CA", status: "no_cumple", bloquea: true })],
      },
    });
    expect(r.falta).toEqual([{ kind: "frena", text: "El aviso no incluye tu país" }]);
  });

  it("skills: «Ya manejás X» y «Piden X y tu nivel es bajo», lenguaje llano", () => {
    const r = buildFitPoints({
      ...empty,
      checklist: {
        items: [
          item({ id: "skill:sql", kind: "skill", pide: "Menciona SQL", status: "cumple" }),
          item({
            id: "skill:dbt",
            kind: "skill",
            pide: "Menciona dbt",
            tenes: "Nivel 1 de 3",
            status: "no_cumple",
          }),
          item({
            id: "skill:airflow",
            kind: "skill",
            pide: "Menciona Airflow",
            status: "no_se_sabe",
          }),
        ],
      },
    });
    expect(r.favor.map((p) => p.text)).toEqual(["Ya manejás SQL"]);
    expect(r.falta.map((p) => p.text)).toEqual([
      "Piden dbt y tu nivel es bajo",
      "tu nivel de Airflow",
    ]);
  });

  it("recorta textos largos", () => {
    const r = buildFitPoints({ ...empty, gaps: ["x".repeat(400)] });
    expect(r.falta[0]!.text.length).toBeLessThanOrEqual(140);
  });

  it("es determinista", () => {
    const input = { ...empty, matchFuerte: ["a b c"], gaps: ["d e f"] };
    expect(buildFitPoints(input)).toEqual(buildFitPoints(input));
  });
});

describe("buildFitPoints: lenguaje llano y sin repeticiones", () => {
  it.each([
    ["años requeridos ≥ 8 (10)", "Piden 10 años de experiencia, más de lo que admite tu búsqueda"],
    ["gap de años: pide 10, el candidato tiene 3", "Piden 10 años de experiencia y tenés 3"],
    [
      "años en otro dominio (publicidad)",
      "Los años que piden son de otro rubro (publicidad), no del tuyo",
    ],
    ["disciplina distinta (project_management)", "Es un puesto de otro oficio que el tuyo"],
    ["jornada de 48 h (máximo 40)", "La jornada es de 48 horas por semana y tu máximo es 40"],
    [
      "salario publicado por debajo del piso (USD 1500/mes < 2000)",
      "Pagan hasta USD 1500 por mes y tu mínimo es USD 2000",
    ],
    ["residencia exigida en CA", "Piden vivir en CA"],
    ["modalidad presencial", "Modalidad presencial"],
  ])("bloqueador «%s»", (raw, plain) => {
    expect(blockerInPlainSpanish(raw)).toBe(plain);
  });

  it("requisitos reales del checklist, sin interpolar el dato crudo del perfil", () => {
    const r = buildFitPoints({
      ...empty,
      checklist: {
        items: [
          item({
            id: "modalidad",
            pide: "Modalidad presencial",
            tenes: "Aceptás: remoto, hibrido",
            status: "no_cumple",
          }),
          item({
            id: "salario",
            pide: "Salario USD 1000–1500/month",
            tenes: "Piso USD 2000/mes",
            status: "no_cumple",
          }),
          item({
            id: "jornada",
            pide: "48 h semanales",
            tenes: "Máximo 40 h",
            status: "no_cumple",
          }),
          item({ id: "anos", pide: "10 años de backend", tenes: "3 años", status: "no_cumple" }),
        ],
      },
    });
    expect(r.falta.map((p) => p.text)).toEqual([
      "Es presencial y vos aceptás: remoto, hibrido",
      "El sueldo publicado queda por debajo de tu mínimo",
      "La jornada supera tu máximo de horas",
      "Piden 10 años de backend y tenés 3 años",
    ]);
  });

  it("con un bloqueador, ni «país» ni «residencia» se repiten como requisito", () => {
    const r = buildFitPoints({
      ...empty,
      bloqueadores: ["residencia exigida en Canada"],
      checklist: {
        items: [
          item({ id: "pais", pide: "Disponible en CA", status: "no_cumple" }),
          item({ id: "residencia", pide: "Residir en Canada", status: "no_cumple", bloquea: true }),
        ],
      },
    });
    expect(r.falta).toEqual([{ kind: "frena", text: "Piden vivir en Canada" }]);
  });

  it("la skill del checklist (niveles de hoy) manda sobre la foto del modelo", () => {
    const r = buildFitPoints({
      ...empty,
      matchFuerte: ["Python", "Excel"],
      gaps: ["Kubernetes"],
      checklist: {
        items: [
          item({
            id: "skill:python",
            kind: "skill",
            pide: "Menciona Python",
            tenes: "Nivel 1 de 3",
            status: "no_cumple",
          }),
          item({ id: "skill:excel", kind: "skill", pide: "Menciona Excel", status: "cumple" }),
        ],
      },
    });
    expect(r.favor.map((p) => p.text)).toEqual(["Ya manejás Excel"]);
    expect(r.falta.map((p) => p.text)).toEqual(["Kubernetes", "Piden Python y tu nivel es bajo"]);
  });

  it("C++ y C# son distintos; «Cosa 1» no absorbe a «Cosa 10»", () => {
    const r = buildFitPoints({
      ...empty,
      matchFuerte: ["C++", "C#", "Cosa número 1", "Cosa número 10"],
    });
    expect(r.favor.map((p) => p.text)).toEqual(["C++", "C#", "Cosa número 1", "Cosa número 10"]);
  });

  it("máximo 3 skills por lista: no tapan riesgos ni gaps", () => {
    const skills = ["a1", "b2", "c3", "d4", "e5"].map((x) =>
      item({
        id: `skill:${x}`,
        kind: "skill",
        pide: `Menciona Skill${x}`,
        status: "no_cumple",
        tenes: "Nivel 0 de 3",
      }),
    );
    const r = buildFitPoints({
      ...empty,
      riesgos: ["salario no publicado"],
      checklist: { items: skills },
    });
    expect(r.falta.map((p) => p.kind)).toEqual(["ojo", "falta", "falta", "falta"]);
  });
});

describe("summarizeFitCard", () => {
  it("1 a favor y 1 que falta o frena, lo más fuerte primero", () => {
    const r = summarizeFitCard({
      ...empty,
      matchFuerte: ["React", "Node"],
      gaps: ["Kafka"],
      riesgos: ["staffing"],
      bloqueadores: ["modalidad presencial"],
    });
    expect(r.favor).toEqual({ kind: "match", text: "React" });
    expect(r.falta).toEqual({ kind: "frena", text: "Modalidad presencial", label: "Te frena" });
  });

  it("sin datos: null en ambos", () => {
    expect(summarizeFitCard(empty)).toEqual({ favor: null, falta: null });
  });

  it("cae a las señales si no hay match, y a los riesgos si no hay gaps ni bloqueadores", () => {
    const r = summarizeFitCard({ ...empty, senales: ["Pocos candidatos"], riesgos: ["staffing"] });
    expect(r.favor?.kind).toBe("senal");
    expect(r.falta).toEqual({ kind: "ojo", text: "Staffing", label: "Ojo" });
  });
});
