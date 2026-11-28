import { describe, expect, it } from "vitest";
import { conditionRows } from "../app/(app)/jobs/[id]/conditions-view";
import {
  fichaTieneContenido,
  fichaView,
  habilidadesDelPuesto,
  queBuscanView,
  type FichaRequisito,
} from "../app/(app)/jobs/[id]/ficha-view";

const req = (texto: string, nivel: FichaRequisito["nivel"]): FichaRequisito => ({
  texto,
  nivel,
  cita: `cita de ${texto}`,
});

describe("queBuscanView", () => {
  it("distingue solo si todos tienen nivel claro", () => {
    const v = queBuscanView([req("A", "indispensable"), req("B", "deseable")]);
    expect(v.distingue).toBe(true);
    expect(v.indispensables.map((r) => r.texto)).toEqual(["A"]);
    expect(v.deseables.map((r) => r.texto)).toEqual(["B"]);
    expect(v.todos).toEqual([]);
  });

  it("aviso que no distingue: una sola lista, sin inventar niveles", () => {
    const v = queBuscanView([req("A", "sin_distinguir"), req("B", "sin_distinguir")]);
    expect(v.distingue).toBe(false);
    expect(v.todos).toHaveLength(2);
    expect(v.indispensables).toEqual([]);
  });

  it("mezcla de niveles: falla cerrado, no distingue", () => {
    const v = queBuscanView([req("A", "indispensable"), req("B", "sin_distinguir")]);
    expect(v.distingue).toBe(false);
    expect(v.todos).toHaveLength(2);
  });

  it("sin requisitos: vacío y sin distinguir", () => {
    const v = queBuscanView([]);
    expect(v.distingue).toBe(false);
    expect(v.todos).toEqual([]);
  });

  it("descarta requisitos sin texto", () => {
    expect(queBuscanView([req("  ", "deseable")]).todos).toEqual([]);
  });
});

describe("fichaView", () => {
  it("resumen vacío no se muestra", () => {
    const v = fichaView({ resumen: { texto: " ", citas: ["x"] }, tareas: [], requisitos: [] });
    expect(v.resumen).toBeNull();
    expect(fichaTieneContenido(v)).toBe(false);
  });

  it("limpia tareas y conserva la cita", () => {
    const v = fichaView({
      resumen: { texto: "Resumen.", citas: ["c", " d "] },
      tareas: [
        { texto: " Atender ", cita: "c1" },
        { texto: "", cita: "c2" },
      ],
      requisitos: [],
    });
    expect(v.tareas).toEqual([{ texto: "Atender", cita: "c1" }]);
    expect(v.resumen).toEqual({ texto: "Resumen.", cita: "c\nd" });
    expect(fichaTieneContenido(v)).toBe(true);
  });
});

describe("habilidadesDelPuesto", () => {
  const filas = [{ pide: "Menciona Excel" }, { pide: "Menciona Atención al cliente" }];

  it("sin ficha no filtra", () => {
    expect(habilidadesDelPuesto(filas, null)).toHaveLength(2);
  });

  it("con ficha deja solo las ligadas al puesto (sin mayúsculas ni tildes)", () => {
    const r = habilidadesDelPuesto(filas, [{ nombre: "atencion al CLIENTE" }]);
    expect(r.map((f) => f.pide)).toEqual(["Menciona Atención al cliente"]);
  });

  it("con ficha sin habilidades queda vacío", () => {
    expect(habilidadesDelPuesto(filas, [])).toEqual([]);
  });
});

describe("conditionRows con ficha", () => {
  const base = {
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    modality: null,
    englishRequired: null,
    yearsRequired: null,
    contractType: null,
  };
  const vacia = {
    modalidad: null,
    desdeDonde: null,
    salario: null,
    experiencia: null,
    ingles: null,
    jornada: null,
    contratacion: null,
  };

  it("usa la ficha con su cita y deja «No especificado» lo que no dice", () => {
    const rows = conditionRows({
      ...base,
      ficha: {
        ...vacia,
        modalidad: { valor: "hibrido", cita: "dos días en oficina" },
        desdeDonde: { alcance: "paises", lugares: ["Argentina"], cita: "residir en Argentina" },
        jornada: { valor: "parcial", cita: "medio tiempo" },
      },
    });
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.modality).toMatchObject({ value: "híbrido", cita: "dos días en oficina" });
    expect(by.location?.value).toBe("Solo desde: Argentina");
    expect(by.hours).toMatchObject({ value: "Jornada parcial", informed: true });
    expect(by.salary).toMatchObject({ value: "No especificado", informed: false });
    expect(by.salary?.cita).toBeUndefined();
  });

  it("«desde dónde» con países sin nombrar: no se deduce", () => {
    const rows = conditionRows({
      ...base,
      ficha: { ...vacia, desdeDonde: { alcance: "paises", lugares: [], cita: "x" } },
    });
    expect(rows.find((r) => r.key === "location")?.informed).toBe(false);
  });

  it("aviso contradictorio: «dice cosas distintas» con las dos citas", () => {
    const rows = conditionRows({
      ...base,
      ficha: {
        ...vacia,
        desdeDonde: { alcance: "contradictorio", lugares: [], cita: "remoto desde cualquier país" },
      },
      fichaRequisitos: [
        { categoria: "residencia", cita: "residir en Chile" },
        { categoria: "habilidad", cita: "Excel" },
      ],
    });
    const loc = rows.find((r) => r.key === "location");
    expect(loc?.value).toBe("El aviso dice cosas distintas");
    expect(loc?.cita).toBe("remoto desde cualquier país\nresidir en Chile");
  });

  it("sin ficha, igual que antes", () => {
    expect(conditionRows(base).every((r) => !r.informed && r.cita === undefined)).toBe(true);
  });
});
