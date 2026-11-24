import { describe, expect, it } from "vitest";
import { buildInterviewReport, type InterviewReportAnswer } from "./report";

const a = (
  position: number,
  clarity: number,
  relevance: number,
  star: number,
  tip = `Consejo ${position}`,
): InterviewReportAnswer => ({ position, clarity, relevance, star, tip });

describe("buildInterviewReport", () => {
  it("sin respuestas no hay informe", () => {
    const r = buildInterviewReport([]);
    expect(r).toEqual({ ok: false, error: "no_answers" });
  });

  it("promedia cada criterio con un decimal y le pone su nivel", () => {
    const r = buildInterviewReport([a(0, 8, 6, 4), a(1, 9, 7, 5), a(2, 7, 6, 3)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.averages).toEqual({
      clarity: { value: 8, level: "high" },
      relevance: { value: 6.3, level: "mid" },
      star: { value: 4, level: "low" },
    });
    expect(r.value.overall).toBe(6.1);
    expect(r.value.count).toBe(3);
  });

  it("elige la mejor y la más floja por el promedio de sus tres puntajes", () => {
    const r = buildInterviewReport([a(0, 6, 6, 6), a(1, 9, 9, 8), a(2, 2, 3, 4), a(3, 7, 7, 7)]);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.best).toEqual({ position: 1, average: 8.7 });
    expect(r.value.worst).toEqual({ position: 2, average: 3 });
  });

  it("si empatan, gana la primera en orden de pregunta", () => {
    const r = buildInterviewReport([a(0, 5, 5, 5), a(1, 5, 5, 5), a(2, 8, 8, 8), a(3, 8, 8, 8)]);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.best?.position).toBe(2);
    expect(r.value.worst?.position).toBe(0);
  });

  it("con una sola respuesta no hay «más floja»", () => {
    const r = buildInterviewReport([a(0, 7, 7, 7)]);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.best?.position).toBe(0);
    expect(r.value.worst).toBeNull();
  });

  it("agrupa los consejos por el criterio más flojo de cada respuesta y ordena por repetición", () => {
    const r = buildInterviewReport([
      a(0, 8, 8, 3, "Contá el resultado"),
      a(1, 4, 8, 8, "Ordená las ideas"),
      a(2, 8, 8, 5, "Sumá una cifra"),
      a(3, 8, 5, 8, "Volvé a la pregunta"),
      a(4, 8, 8, 2, "Nombrá tu rol"),
    ]);
    if (!r.ok) throw new Error("debía ser ok");
    const groups = r.value.tipGroups;
    expect(groups.map((g) => [g.code, g.count])).toEqual([
      ["star", 3],
      ["clarity", 1],
      ["relevance", 1],
    ]);
    // El consejo que representa al grupo es el de la respuesta más floja en ese criterio
    expect(groups[0]?.tip).toBe("Nombrá tu rol");
    expect(groups[0]?.positions).toEqual([0, 2, 4]);
  });

  it("devuelve como máximo tres grupos y desempata siempre igual", () => {
    const r = buildInterviewReport([a(0, 5, 5, 5), a(1, 5, 5, 5)]);
    if (!r.ok) throw new Error("debía ser ok");
    expect(r.value.tipGroups.length).toBeLessThanOrEqual(3);
    // Con todo parejo el criterio de la respuesta es STAR: la estructura es lo más mejorable
    expect(r.value.tipGroups[0]?.code).toBe("star");
    expect(r.value.tipGroups[0]?.count).toBe(2);
  });

  it("es una función pura: no modifica lo que recibe", () => {
    const input = [a(1, 3, 4, 5), a(0, 9, 9, 9)];
    const copy = structuredClone(input);
    buildInterviewReport(input);
    expect(input).toEqual(copy);
  });
});
