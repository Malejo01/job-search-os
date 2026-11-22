import { describe, expect, it } from "vitest";
import { affinityBreakdown, affinityLevel, type AffinityInput } from "./affinity-breakdown";

const base: AffinityInput = {
  matchFuerte: [],
  gaps: [],
  riesgos: [],
  bloqueadores: [],
  adjustments: [],
  yearsRequired: null,
  locationOk: "ok",
  modality: null,
  englishRequired: "no_menciona",
  englishGap: false,
  salaryMinUsd: null,
  salaryMaxUsd: null,
};

function item(input: Partial<AffinityInput>, key: string) {
  const found = affinityBreakdown({ ...base, ...input }).find((i) => i.key === key);
  if (!found) throw new Error(`falta el criterio ${key}`);
  return found;
}

describe("affinityLevel", () => {
  it("traduce el puntaje a un nivel", () => {
    expect(affinityLevel(10)).toBe("high");
    expect(affinityLevel(7.5)).toBe("high");
    expect(affinityLevel(7)).toBe("mid");
    expect(affinityLevel(5.5)).toBe("mid");
    expect(affinityLevel(5)).toBe("low");
    expect(affinityLevel(3.5)).toBe("low");
    expect(affinityLevel(3)).toBe("far");
    expect(affinityLevel(0)).toBe("far");
  });
});

describe("affinityBreakdown", () => {
  it("devuelve siempre los criterios fijos y el sueldo solo si el aviso lo informa", () => {
    const keys = affinityBreakdown(base).map((i) => i.key);
    expect(keys).toEqual(["role_skills", "seniority", "location", "language"]);
    const withSalary = affinityBreakdown({ ...base, salaryMaxUsd: 3000 }).map((i) => i.key);
    expect(withSalary).toEqual(["role_skills", "seniority", "location", "language", "salary"]);
  });

  it("sin datos no inventa puntaje", () => {
    const r = item({}, "role_skills");
    expect(r.score).toBeNull();
    expect(r.level).toBeNull();
    expect(item({}, "seniority").score).toBeNull();
    expect(item({}, "language").score).toBeNull();
  });

  it("rol y habilidades: proporción de calces sobre calces más faltas", () => {
    const r = item({ matchFuerte: ["a", "b", "c"], gaps: ["d"] }, "role_skills");
    expect(r.score).toBe(7.5);
    expect(r.level).toBe("high");
    expect(item({ matchFuerte: ["a"], gaps: ["b", "c", "d"] }, "role_skills").level).toBe("far");
  });

  it("rol y habilidades: el tope por disciplina baja el puntaje", () => {
    const r = item(
      {
        matchFuerte: ["a", "b"],
        gaps: [],
        adjustments: [{ rule: "discipline_cap", delta: -4, detail: "x" }],
      },
      "role_skills",
    );
    expect(r.score).toBe(6);
  });

  it("seniority: años pedidos sin penalización dan 10; con penalización bajan", () => {
    expect(item({ yearsRequired: 3 }, "seniority").score).toBe(10);
    const r = item(
      {
        yearsRequired: 8,
        adjustments: [{ rule: "years_gap_penalty", delta: -2.5, detail: "x" }],
      },
      "seniority",
    );
    expect(r.score).toBe(7.5);
  });

  it("seniority: un tope por título cuenta aunque no haya años", () => {
    const r = item({ adjustments: [{ rule: "title_cap", delta: -3, detail: "x" }] }, "seniority");
    expect(r.score).toBe(7);
  });

  it("ubicación: usa location_ok y los ajustes de residencia, sin pasar de 0", () => {
    expect(item({ locationOk: "ok" }, "location").score).toBe(10);
    expect(item({ locationOk: "riesgo" }, "location").score).toBe(5);
    expect(item({ locationOk: "no" }, "location").score).toBe(0);
    const r = item(
      {
        locationOk: "riesgo",
        adjustments: [{ rule: "residencia_exigida", delta: -9, detail: "x" }],
      },
      "location",
    );
    expect(r.score).toBe(0);
  });

  it("ubicación: sin location_ok conocido no hay puntaje", () => {
    expect(item({ locationOk: null }, "location").score).toBeNull();
  });

  it("idioma: 'no pide' da 10, 'no menciona' sin datos y una brecha baja", () => {
    expect(item({ englishRequired: "no" }, "language").score).toBe(10);
    expect(item({ englishRequired: "no_menciona" }, "language").score).toBeNull();
    expect(item({ englishRequired: "avanzado", englishGap: true }, "language").score).toBe(6);
  });

  it("idioma: la penalización por inglés fluido resta", () => {
    const r = item(
      {
        englishRequired: "avanzado",
        adjustments: [{ rule: "english_fluent_penalty", delta: -1, detail: "x" }],
      },
      "language",
    );
    expect(r.score).toBe(9);
  });

  it("sueldo: informado sin alertas da 10; con alerta de rango 6; con alerta de máximo 2", () => {
    expect(item({ salaryMinUsd: 2000, salaryMaxUsd: 3000 }, "salary").score).toBe(10);
    expect(
      item(
        { salaryMaxUsd: 3000, riesgos: ["el rango salarial empieza abajo de tu piso"] },
        "salary",
      ).score,
    ).toBe(6);
    expect(
      item(
        {
          salaryMaxUsd: 900,
          bloqueadores: ["salario publicado por debajo del piso (USD 900/mes < 1500)"],
        },
        "salary",
      ).score,
    ).toBe(2);
  });

  it("todos los puntajes están entre 0 y 10 en pasos de 0,5", () => {
    const items = affinityBreakdown({
      ...base,
      matchFuerte: ["a", "b", "c"],
      gaps: ["d", "e"],
      yearsRequired: 5,
      englishRequired: "avanzado",
      salaryMinUsd: 1000,
      adjustments: [{ rule: "years_penalty", delta: -20, detail: "x" }],
    });
    for (const i of items) {
      if (i.score === null) continue;
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(10);
      expect(i.score * 2).toBe(Math.round(i.score * 2));
    }
  });
});
