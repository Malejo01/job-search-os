import { describe, expect, it } from "vitest";
import {
  assessPoolTitle,
  isTooSenior,
  strongTitlePattern,
  titleFit,
  titleLevel,
} from "./title-fit";

describe("titleFit", () => {
  it("2 cuando el título nombra el cargo", () => {
    expect(titleFit("Data Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Analista de Datos Semi Senior", "data_analyst")).toBe(2);
    expect(titleFit("BI Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Reporting Analyst, Finance", "data_analyst")).toBe(2);
    expect(titleFit("Insights Analyst", "data_analyst")).toBe(2);
    expect(titleFit("Analytics Analyst II", "data_analyst")).toBe(2);
    expect(titleFit("Business Intelligence Developer", "data_analyst")).toBe(2);
    expect(titleFit("Fraud Data Analyst", "data_analyst")).toBe(2);
  });

  it("analytics engineer no se veta", () => {
    expect(titleFit("Analytics Engineer", "data_analyst")).toBe(2);
  });

  it("con frase fuerte no hay veto aunque el título mencione otra disciplina", () => {
    expect(titleFit("Data Analyst / Data Engineer", "data_analyst")).toBe(2);
    expect(titleFit("Data Analyst, Machine Learning", "data_analyst")).toBe(2);
  });

  it("0 cuando el título nombra otra disciplina y no tiene frase del puesto", () => {
    for (const t of [
      "Senior Data Engineer",
      "Data Scientist",
      "Machine Learning Researcher",
      "ML Engineer",
      "AI Engineer",
      "Research Scientist",
      "Applied Scientist",
      "MLOps Specialist",
      "Staff Software Engineer, Data Platform",
      "Backend Engineer (Data)",
      "Frontend Developer, Data Products",
      "Full Stack Engineer",
      "DevOps Engineer",
      "SRE, Data",
      "Platform Engineer",
    ]) {
      expect(titleFit(t, "data_analyst"), t).toBe(0);
    }
  });

  it("1 cuando el puesto vino de la categoría y el título no nombra otra disciplina", () => {
    expect(titleFit("Reporting Specialist", "data_analyst")).toBe(1);
    expect(titleFit("Junior Associate", "data_analyst")).toBe(1);
  });

  it("ai_engineer: 2 con frase o patrón AI + rol técnico; 0 con palabra excluida sin frase", () => {
    expect(titleFit("Machine Learning Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Software Engineer", "ai_engineer")).toBe(2);
    expect(titleFit("AI Sales Specialist", "ai_engineer")).toBe(0);
    expect(titleFit("AI Customer Support Lead", "ai_engineer")).toBe(0);
    expect(titleFit("Solutions Specialist", "ai_engineer")).toBe(1);
  });

  it("puestos sin veto definido dan 2 con frase y 1 sin ella", () => {
    expect(titleFit("QA Automation Engineer", "qa")).toBe(2);
    expect(titleFit("Release Coordinator", "qa")).toBe(1);
  });
});

describe("strongTitlePattern", () => {
  it("arma una alternancia con las frases de los puestos; sin puestos, null", () => {
    expect(strongTitlePattern([])).toBeNull();
    const p = strongTitlePattern(["data_analyst"])!;
    expect(p).toContain("data[^[:alnum:]]+analyst");
    expect(p.startsWith("\\m(")).toBe(true);
    expect(p.endsWith(")s?\\M")).toBe(true);
  });
});

describe("titleLevel", () => {
  it("staff_plus por palabra, sin pedir rol técnico", () => {
    for (const t of [
      "Staff ML Engineer",
      "Principal Data Analyst",
      "Head of Data",
      "Director of Analytics",
      "VP Engineering",
      "Chief Data Officer",
      "Group Product Manager",
      "Group Engineering Lead",
      "Group Manager",
    ]) {
      expect(titleLevel(t), t).toBe("staff_plus");
    }
  });

  it("group suelto no cuenta", () => {
    expect(titleLevel("Data Analyst, Risk Group")).toBeNull();
    expect(titleLevel("Analyst, Group Reporting")).toBeNull();
  });

  it("senior solo si es Senior o Lead puros", () => {
    expect(titleLevel("Senior Data Engineer")).toBe("senior");
    expect(titleLevel("Sr. Data Analyst")).toBe("senior");
    expect(titleLevel("Tech Lead, Data")).toBe("senior");
    expect(titleLevel("Mid/Senior Data Analyst")).toBeNull();
    expect(titleLevel("Junior to Senior Analyst")).toBeNull();
    expect(titleLevel("Data Analyst")).toBeNull();
    expect(titleLevel("Lead Generation Analyst")).toBeNull();
  });

  it("staff_plus manda sobre senior", () => {
    expect(titleLevel("Senior Staff Engineer")).toBe("staff_plus");
  });
});

describe("isTooSenior", () => {
  it("staff_plus con menos de 5 años; nada con 5 o más o sin dato", () => {
    expect(isTooSenior("Staff Data Analyst", 3)).toBe(true);
    expect(isTooSenior("Staff Data Analyst", 5)).toBe(false);
    expect(isTooSenior("Staff Data Analyst", null)).toBe(false);
    expect(isTooSenior("Staff Data Analyst", undefined)).toBe(false);
    expect(isTooSenior("Senior Data Analyst", 3)).toBe(false);
  });
});

describe("assessPoolTitle", () => {
  const base = { roles: ["data_analyst"] as const, yearsTotal: 3 };

  it("titleFit es el máximo entre los puestos de la persona que están en los hints", () => {
    const r = assessPoolTitle({
      title: "Data Analyst",
      roleHints: ["data_analyst", "backend"],
      roles: ["backend", "data_analyst"],
      yearsTotal: null,
    });
    expect(r.titleFit).toBe(2);
  });

  it("sin ningún puesto de la persona en los hints, 0", () => {
    const r = assessPoolTitle({ ...base, title: "Data Analyst", roleHints: ["qa"] });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual(["qa"]);
  });

  it("el puesto vetado sale de los hints efectivos", () => {
    const r = assessPoolTitle({
      ...base,
      title: "Senior Data Engineer",
      roleHints: ["data_analyst"],
    });
    expect(r.titleFit).toBe(0);
    expect(r.effectiveHints).toEqual([]);
  });

  it("el puesto con fit 1 o 2 se queda en los hints efectivos", () => {
    const r = assessPoolTitle({ ...base, title: "Data Analyst", roleHints: ["data_analyst"] });
    expect(r.effectiveHints).toEqual(["data_analyst"]);
  });

  it("menos de 5 años: staff_plus se descarta y senior penaliza", () => {
    const staff = assessPoolTitle({
      ...base,
      title: "Staff Data Analyst",
      roleHints: ["data_analyst"],
    });
    expect(staff.tooSenior).toBe(true);
    expect(staff.seniorPenalty).toBe(0);
    const senior = assessPoolTitle({
      ...base,
      title: "Senior Data Analyst",
      roleHints: ["data_analyst"],
    });
    expect(senior.tooSenior).toBe(false);
    expect(senior.seniorPenalty).toBe(1);
  });

  it("5 años o más, o sin dato, no cambia nada", () => {
    for (const yearsTotal of [5, 12, null]) {
      const staff = assessPoolTitle({
        ...base,
        yearsTotal,
        title: "Principal Data Analyst",
        roleHints: ["data_analyst"],
      });
      expect(staff.tooSenior).toBe(false);
      expect(staff.seniorPenalty).toBe(0);
      expect(staff.level).toBe("staff_plus");
    }
  });
});
