import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../evaluator/checklist";
import {
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
      "Podés trabajar desde tu país",
      "Inglés intermedio: lo cumplís",
      "TypeScript",
      "APIs",
      "Pocos candidatos",
    ]);
    expect(r.favor.map((p) => p.kind)).toEqual(["cumple", "cumple", "match", "match", "senal"]);
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
      { kind: "frena", text: "Años requeridos ≥ 8 (10)" },
      { kind: "falta", text: "Inglés avanzado: no lo cumplís (vos: B1)" },
      { kind: "falta", text: "Kafka" },
      { kind: "ojo", text: "Salario no publicado" },
      { kind: "sin_dato", text: "No sabemos si cumplís: 40 h semanales" },
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
    expect(r.falta).toEqual([{ kind: "frena", text: "Aviso limitado a CA (no incluye tu país)" }]);
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
      "No sabemos tu nivel de Airflow",
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
