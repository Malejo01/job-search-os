import { describe, expect, it } from "vitest";
import {
  GAP_MAX_TOPICS,
  currentGap,
  detectGaps,
  gapKeyForHistory,
  gapKeyForSkill,
  gapRefFromKey,
  hasConcreteDuty,
  hasResultNumber,
  pendingGaps,
  withOpenGap,
  type GapHistoryRow,
  type GapSkillRow,
} from "./detect";
import { initialGapState } from "./flow";

const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";

const row = (over: Partial<GapHistoryRow> = {}): GapHistoryRow => ({
  id: ID_A,
  kind: "trabajo",
  organization: "Empresa A",
  title: "Analista",
  startMonth: "2021-03",
  endMonth: null,
  bullets: ["Armaba reportes semanales para el área comercial", "Bajé el cierre de 5 a 3 días"],
  ...over,
});

describe("hasConcreteDuty y hasResultNumber", () => {
  it("una tarea concreta tiene varias palabras", () => {
    expect(hasConcreteDuty(["Atendía"])).toBe(false);
    expect(hasConcreteDuty(["Atendía a los clientes por teléfono"])).toBe(true);
    expect(hasConcreteDuty([])).toBe(false);
  });
  it("un resultado trae un número", () => {
    expect(hasResultNumber(["Mejoré el proceso"])).toBe(false);
    expect(hasResultNumber(["Mejoré el proceso un 20%"])).toBe(true);
  });
});

describe("detectGaps", () => {
  it("un trabajo completo no deja huecos", () => {
    expect(detectGaps([row()], [])).toEqual([]);
  });

  it("detecta fechas, tareas y logro de cada trabajo, en ese orden, con clave estable", () => {
    const gaps = detectGaps([row({ startMonth: null, bullets: [] })], []);
    expect(gaps.map((g) => g.topic)).toEqual(["dates", "duties", "achievement"]);
    expect(gaps[0]).toMatchObject({
      key: gapKeyForHistory(ID_A, "dates"),
      historyId: ID_A,
      organization: "Empresa A",
      skillSlug: null,
    });
  });

  it("tareas vagas y sin número: pide tareas y logro, no fechas", () => {
    const gaps = detectGaps([row({ bullets: ["Ayudaba"] })], []);
    expect(gaps.map((g) => g.topic)).toEqual(["duties", "achievement"]);
  });

  it("un fin de fecha vacío no es hueco (puede ser el trabajo actual)", () => {
    expect(detectGaps([row({ endMonth: null })], [])).toEqual([]);
  });

  it("ignora estudios y certificaciones", () => {
    const gaps = detectGaps(
      [
        row({ kind: "educacion", bullets: [], startMonth: null }),
        row({ id: ID_B, kind: "certificacion", bullets: [] }),
      ],
      [],
    );
    expect(gaps).toEqual([]);
  });

  it("las skills con nivel tutorial piden el nivel; las demás no", () => {
    const skills: GapSkillRow[] = [
      { slug: "sql", name: "SQL", level: 1 },
      { slug: "excel", name: "Excel", level: 3 },
      { slug: "nunca", name: "Nunca", level: 0 },
    ];
    const gaps = detectGaps([], skills);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      key: gapKeyForSkill("sql"),
      topic: "skill_level",
      skillSlug: "sql",
      skillName: "SQL",
      historyId: null,
    });
  });

  it("deja afuera una skill cuyo slug no entra en una clave válida", () => {
    expect(detectGaps([], [{ slug: "node.js con espacio", name: "Node", level: 1 }])).toEqual([]);
  });

  it("acota el total y reserva lugar para las skills", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({
        id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`,
        startMonth: null,
        bullets: [],
      }),
    );
    const skills: GapSkillRow[] = ["a", "b", "c", "d"].map((s) => ({
      slug: s,
      name: s.toUpperCase(),
      level: 1,
    }));
    const gaps = detectGaps(rows, skills);
    expect(gaps).toHaveLength(GAP_MAX_TOPICS);
    expect(gaps.filter((g) => g.topic === "skill_level")).toHaveLength(3);
    expect(gaps.slice(-3).every((g) => g.topic === "skill_level")).toBe(true);
  });
});

describe("gapRefFromKey y withOpenGap", () => {
  const skills: GapSkillRow[] = [{ slug: "sql", name: "SQL", level: 2 }];

  it("arma el tema desde la base aunque ya no sea un hueco", () => {
    // la fila está completa: detectGaps no la lista, pero la repregunta sigue apuntando a ella
    const complete = row();
    expect(detectGaps([complete], skills)).toEqual([]);
    expect(gapRefFromKey(gapKeyForHistory(ID_A, "dates"), [complete], skills)).toMatchObject({
      topic: "dates",
      historyId: ID_A,
      organization: "Empresa A",
    });
    expect(gapRefFromKey(gapKeyForSkill("sql"), [], skills)).toMatchObject({
      topic: "skill_level",
      skillSlug: "sql",
      skillName: "SQL",
    });
  });

  it("rechaza claves mal formadas, de filas ajenas, de estudios o de skills que no son de la persona", () => {
    expect(gapRefFromKey("cualquier:cosa", [row()], skills)).toBeNull();
    expect(gapRefFromKey(gapKeyForHistory(ID_B, "dates"), [row()], skills)).toBeNull();
    expect(
      gapRefFromKey(gapKeyForHistory(ID_A, "dates"), [row({ kind: "educacion" })], skills),
    ).toBeNull();
    expect(gapRefFromKey(gapKeyForSkill("excel"), [], skills)).toBeNull();
    expect(gapRefFromKey(`${ID_A}:skill_level`, [row()], skills)).toBeNull();
  });

  it("withOpenGap suma el tema abierto una sola vez", () => {
    const gaps = detectGaps([row({ startMonth: null })], []);
    const open = gapRefFromKey(gapKeyForHistory(ID_A, "duties"), [row()], [])!;
    expect(withOpenGap(gaps, open).map((g) => g.key)).toEqual([open.key, gaps[0]!.key]);
    expect(withOpenGap(gaps, gaps[0]!)).toHaveLength(gaps.length);
    expect(withOpenGap(gaps, null)).toEqual(gaps);
  });
});

describe("pendingGaps y currentGap", () => {
  const gaps = detectGaps(
    [row({ startMonth: null, bullets: [] }), row({ id: ID_C, bullets: [] })],
    [],
  );

  it("quita los cerrados y devuelve el primero que queda", () => {
    const state = { ...initialGapState(), answered: [gaps[0]!.key] };
    expect(pendingGaps(gaps, state).map((g) => g.key)).not.toContain(gaps[0]!.key);
    expect(currentGap(gaps, state)?.key).toBe(gaps[1]!.key);
  });

  it("respeta el tema abierto por una repregunta si sigue pendiente", () => {
    const state = { ...initialGapState(), current: gaps[2]!.key };
    expect(currentGap(gaps, state)?.key).toBe(gaps[2]!.key);
  });

  it("un `current` que no es de los huecos del servidor se ignora", () => {
    const state = { ...initialGapState(), current: "otra:clave" };
    expect(currentGap(gaps, state)?.key).toBe(gaps[0]!.key);
  });

  it("sin pendientes devuelve null", () => {
    const state = { ...initialGapState(), answered: gaps.map((g) => g.key) };
    expect(currentGap(gaps, state)).toBeNull();
  });
});
