import { describe, expect, it } from "vitest";
import {
  USAGE_K,
  USAGE_METRICS,
  USAGE_WEEKS,
  buildUsageGrid,
  parseUsageRows,
  usageWeeks,
  type UsageRow,
} from "./usage-by-career";

// Lunes 17/11/2026 12:00 en Buenos Aires = 15:00 UTC
const NOW = new Date("2026-11-18T15:00:00Z");

function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    week: "2026-11-16",
    career: "backend",
    metric: "active",
    value: 5,
    people: 5,
    ...over,
  };
}

describe("usageWeeks", () => {
  it("devuelve 8 lunes de Buenos Aires, de la más vieja a la actual", () => {
    const weeks = usageWeeks(NOW);
    expect(weeks).toHaveLength(USAGE_WEEKS);
    expect(weeks[USAGE_WEEKS - 1]).toBe("2026-11-16");
    expect(weeks[0]).toBe("2026-09-28");
    for (const w of weeks) expect(new Date(`${w}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it("usa la hora de Buenos Aires: el domingo 23:30 local todavía es la semana anterior", () => {
    // domingo 22/11 23:30 ART = lunes 23/11 02:30 UTC
    expect(usageWeeks(new Date("2026-11-23T02:30:00Z")).at(-1)).toBe("2026-11-16");
    // lunes 23/11 00:30 ART = 03:30 UTC: ya es la semana nueva
    expect(usageWeeks(new Date("2026-11-23T03:30:00Z")).at(-1)).toBe("2026-11-23");
  });

  it("acepta otra cantidad de semanas", () => {
    expect(usageWeeks(NOW, 2)).toEqual(["2026-11-09", "2026-11-16"]);
  });
});

describe("parseUsageRows", () => {
  it("acepta filas válidas, también con value y people en null", () => {
    expect(parseUsageRows([row(), row({ value: null, people: null })])).toHaveLength(2);
  });

  it("falla cerrado con una forma distinta", () => {
    expect(parseUsageRows(null)).toBeNull();
    expect(parseUsageRows([{ ...row(), metric: "otra" }])).toBeNull();
    expect(parseUsageRows([{ ...row(), week: "16/11" }])).toBeNull();
    expect(parseUsageRows([{ ...row(), value: -1 }])).toBeNull();
    expect(parseUsageRows([{ ...row(), career: "Texto Libre!" }])).toBeNull();
    expect(parseUsageRows([{ ...row(), email: "a@example.com" }])).not.toBeNull(); // campos extra se descartan
  });

  it("descarta los campos que no son del contrato", () => {
    const parsed = parseUsageRows([{ ...row(), email: "a@example.com" }]);
    expect(parsed?.[0]).not.toHaveProperty("email");
  });
});

describe("buildUsageGrid", () => {
  it("una celda con 3 o más personas muestra el valor", () => {
    const grid = buildUsageGrid([row({ value: 12, people: 3 })], NOW);
    const cell = grid.careers[0]!.cells["2026-11-16"]!.active;
    expect(cell).toEqual({ kind: "value", value: 12 });
  });

  it(`con menos de ${USAGE_K} personas es «menos de 3» y no deja pasar el conteo de acciones`, () => {
    const grid = buildUsageGrid(
      [row({ value: 40, people: 2 }), row({ metric: "evaluated", value: 80, people: 5 })],
      NOW,
    );
    const cells = grid.careers[0]!.cells["2026-11-16"]!;
    expect(cells.active).toEqual({ kind: "small" });
    expect(JSON.stringify(cells.active)).not.toContain("40");
    expect(cells.evaluated).toEqual({ kind: "value", value: 80 });
  });

  it("aunque la base mande el valor sin enmascarar, con people menor que 3 igual se oculta", () => {
    const grid = buildUsageGrid(
      [
        row({ value: 9, people: 1 }),
        row({ metric: "up", value: 7, people: 2 }),
        row({ metric: "evaluated", value: 30, people: 6 }),
      ],
      NOW,
    );
    const cells = grid.careers[0]!.cells["2026-11-16"]!;
    expect(cells.active.kind).toBe("small");
    expect(cells.up.kind).toBe("small");
  });

  it("value sin people (o al revés) no se muestra", () => {
    const grid = buildUsageGrid(
      [
        row({ value: 9, people: null }),
        row({ metric: "up", value: null, people: 8 }),
        row({ metric: "down", value: 4, people: 4 }),
      ],
      NOW,
    );
    const cells = grid.careers[0]!.cells["2026-11-16"]!;
    expect(cells.active.kind).toBe("small");
    expect(cells.up.kind).toBe("small");
    expect(cells.down.kind).toBe("value");
  });

  it("una celda sin fila también es «menos de 3»: no se distingue el cero de 1 o 2 personas", () => {
    const grid = buildUsageGrid([row()], NOW);
    const cells = grid.careers[0]!.cells["2026-11-09"]!;
    for (const m of USAGE_METRICS) expect(cells[m]).toEqual({ kind: "small" });
  });

  it("cada carrera trae las 8 semanas y las 8 métricas", () => {
    const grid = buildUsageGrid([row()], NOW);
    expect(grid.weeks).toHaveLength(USAGE_WEEKS);
    const career = grid.careers[0]!;
    expect(Object.keys(career.cells)).toEqual(grid.weeks);
    for (const w of grid.weeks)
      expect(Object.keys(career.cells[w]!).sort()).toEqual([...USAGE_METRICS].sort());
  });

  it("ignora filas de semanas fuera de la ventana", () => {
    const grid = buildUsageGrid([row({ week: "2025-01-06" })], NOW);
    expect(grid.careers).toHaveLength(0);
  });

  it("omite las carreras sin ninguna celda visible", () => {
    const grid = buildUsageGrid(
      [row({ career: "qa", value: 3, people: 2 }), row({ career: "backend" })],
      NOW,
    );
    expect(grid.careers.map((c) => c.career)).toEqual(["backend"]);
  });

  it("ordena por personas activas de la última semana visible, con sin_carrera al final", () => {
    const grid = buildUsageGrid(
      [
        row({ career: "sin_carrera", value: 50, people: 50 }),
        row({ career: "frontend", value: 4, people: 4 }),
        row({ career: "backend", value: 9, people: 9 }),
      ],
      NOW,
    );
    expect(grid.careers.map((c) => c.career)).toEqual(["backend", "frontend", "sin_carrera"]);
  });

  it("no hay fila de total entre carreras (no se puede restar para destapar una celda chica)", () => {
    const grid = buildUsageGrid([row()], NOW);
    expect(grid.careers.some((c) => c.career === "total")).toBe(false);
  });

  it("sin filas devuelve la grilla vacía con sus semanas", () => {
    const grid = buildUsageGrid([], NOW);
    expect(grid.careers).toEqual([]);
    expect(grid.weeks).toHaveLength(USAGE_WEEKS);
  });
});
