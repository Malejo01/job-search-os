import { describe, expect, it } from "vitest";
import {
  STUDY_HOURS_DEFAULT,
  buildStudyRoute,
  parseStudyHours,
  pickWeekFocus,
  simulateSkillImpact,
  simulateSkills,
  type RouteStep,
  type SimCandidate,
  type SimInput,
} from "./simulate";

describe("«Esta semana» (C-3 E4c)", () => {
  const step = (slug: string, hours: number): RouteStep => ({
    slug,
    name: slug,
    hours,
    estimated: false,
    delta: 1,
    weekFrom: 1,
    weekTo: 1,
  });
  const route = [step("python", 20), step("tableau", 3), step("power_bi", 11)];

  it("sin ruta, nada", () => {
    expect(pickWeekFocus([], new Map(), 5)).toBeNull();
  });

  it("el primer paso de la ruta; las horas de la semana con tope en lo que falta", () => {
    expect(pickWeekFocus(route, new Map(), 5)).toEqual({
      step: route[0],
      hoursThisWeek: 5,
      hoursLeft: 20,
    });
    expect(pickWeekFocus([step("tableau", 3)], new Map(), 5)?.hoursThisWeek).toBe(3);
  });

  it("si una skill de la ruta ya está en curso, esa va primero", () => {
    const statuses = new Map([
      ["python", "pendiente"],
      ["power_bi", "en_curso"],
    ] as const);
    expect(pickWeekFocus(route, statuses, 10)?.step.slug).toBe("power_bi");
  });

  it("las cerradas no cuentan", () => {
    const statuses = new Map([["python", "cerrada"]] as const);
    expect(pickWeekFocus(route, statuses, 5)?.step.slug).toBe("tableau");
    const all = new Map(route.map((s) => [s.slug, "cerrada"] as const));
    expect(pickWeekFocus(route, all, 5)).toBeNull();
  });
});

/** Skill de una oferta: «slug» o «slug!» si es excluyente. */
function offer(id: string, skills: string[], flags: string[] = []): SimCandidate {
  const parsed = skills.map((s) => {
    const slug = s.replace("!", "");
    return { slug, name: slug, isMust: s.endsWith("!") };
  });
  return { id, flags, skills: parsed, salaryMaxUsd: null };
}

// Ejemplo del diseño de la 121 (§3): persona ficticia de Data Analyst, sin piso salarial
const LEVELS = new Map(
  Object.entries({
    sql: 2,
    excel: 3,
    python: 1,
    statistics: 1,
    english_intermediate: 2,
    power_bi: 0,
    tableau: 0,
  }),
);
const CANDIDATES = [
  offer("A", ["sql!", "power_bi!", "excel"]),
  offer("B", ["sql", "python!", "power_bi!", "english_intermediate"]),
  offer("C", ["excel", "power_bi!", "statistics"], ["location_risk"]),
  offer("D", ["tableau!", "sql"]),
  offer("E", ["python!", "sql", "statistics", "etl"]),
];
const INPUT: SimInput = { candidates: CANDIDATES, levels: LEVELS, salaryFloorUsd: null };

describe("simulador «si aprendés X» (121 §3, C-3 E3)", () => {
  it("reproduce el ejemplo del diseño: hoy entra 1 de 5", () => {
    expect(simulateSkills(INPUT, [])).toEqual({ total: 5, passNow: 1, passAfter: 1 });
  });

  it("power_bi la piden 3 (todas excluyentes) y suma 1; python suma 2; tableau, 1", () => {
    const powerBi = simulateSkillImpact(INPUT, "power_bi");
    expect(powerBi).toMatchObject({ asks: 3, asksMust: 3, passNow: 1, passAfter: 2, delta: 1 });
    expect(powerBi.exampleIds).toEqual(["B"]);
    const python = simulateSkillImpact(INPUT, "python");
    expect(python).toMatchObject({ asks: 2, asksMust: 2, delta: 2 });
    expect(python.exampleIds).toEqual(["B", "E"]);
    expect(simulateSkillImpact(INPUT, "tableau")).toMatchObject({ asks: 1, delta: 1 });
  });

  it("combinadas no se cuentan dos veces", () => {
    expect(simulateSkills(INPUT, ["power_bi", "python"]).passAfter).toBe(3);
  });

  it("la ruta greedy da python, tableau y power_bi, repartidas en semanas", () => {
    const skills = [
      { slug: "power_bi", name: "Power BI", hours: 16, priority: 2 },
      { slug: "python", name: "Python", hours: null, priority: 1 },
      { slug: "tableau", name: "Tableau", hours: 16, priority: 1 },
    ];
    const route = buildStudyRoute(INPUT, skills, 5);
    expect(route.map((r) => r.slug)).toEqual(["python", "tableau", "power_bi"]);
    expect(route.map((r) => [r.weekFrom, r.weekTo])).toEqual([
      [1, 4],
      [5, 7],
      [8, 10],
    ]);
    expect(route[0]).toMatchObject({ hours: 20, estimated: true, delta: 2 });
    // Después de python, power_bi ya no suma B: la oferta ya entra
    expect(route[2]).toMatchObject({ slug: "power_bi", delta: 0 });
  });

  it("con más horas por semana, la misma ruta se comprime", () => {
    const skills = [{ slug: "python", name: "Python", hours: 20, priority: 1 }];
    expect(buildStudyRoute(INPUT, skills, 10)[0]).toMatchObject({ weekFrom: 1, weekTo: 2 });
  });
});

describe("?horas= del plan (C-3 E4b)", () => {
  it("acepta solo 3, 5 o 10", () => {
    expect(parseStudyHours("3")).toBe(3);
    expect(parseStudyHours("10")).toBe(10);
    expect(parseStudyHours(" 5 ")).toBe(5);
  });

  it("lo demás vuelve a las horas por defecto", () => {
    for (const raw of [undefined, null, "", "4", "0", "-3", "3.5", "10abc", "100"]) {
      expect(parseStudyHours(raw)).toBe(STUDY_HOURS_DEFAULT);
    }
    expect(STUDY_HOURS_DEFAULT).toBe(5);
  });

  it("con el parámetro repetido toma el primero", () => {
    expect(parseStudyHours(["10", "3"])).toBe(10);
    expect(parseStudyHours([])).toBe(STUDY_HOURS_DEFAULT);
  });
});
