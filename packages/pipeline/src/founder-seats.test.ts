import { describe, expect, it } from "vitest";
import {
  FOUNDER_TOTAL_KEY,
  FOUNDER_NO_CAREER_KEY,
  founderSeatRows,
  parseFounderCounts,
} from "./founder-seats";
import { FOUNDER_SEATS_PER_CAREER } from "./plans";

describe("FOUNDER_SEATS_PER_CAREER", () => {
  it("no se inventa el cupo: queda null hasta confirmarlo", () => {
    expect(FOUNDER_SEATS_PER_CAREER).toBeNull();
  });
});

describe("parseFounderCounts", () => {
  it("acepta filas con número o null", () => {
    expect(
      parseFounderCounts([
        { role: "backend", people: 4 },
        { role: "qa", people: null },
      ]),
    ).toEqual([
      { role: "backend", people: 4 },
      { role: "qa", people: null },
    ]);
  });

  it("falla cerrado: forma rara, clave con caracteres raros o número negativo", () => {
    expect(parseFounderCounts(null)).toBeNull();
    expect(parseFounderCounts({ role: "backend" })).toBeNull();
    expect(parseFounderCounts([{ role: "Texto Libre!", people: 3 }])).toBeNull();
    expect(parseFounderCounts([{ role: "qa", people: -1 }])).toBeNull();
    expect(parseFounderCounts([{ role: "qa", people: 1.5 }])).toBeNull();
  });
});

describe("founderSeatRows", () => {
  const rows = [
    { role: FOUNDER_TOTAL_KEY, people: 9 },
    { role: FOUNDER_NO_CAREER_KEY, people: null },
    { role: "qa", people: null },
    { role: "backend", people: 5 },
    { role: "frontend", people: 4 },
  ];

  it("sin cupo muestra solo cuántas personas hay, sin «de N»", () => {
    const out = founderSeatRows(rows, null);
    expect(out.map((r) => r.value)).toEqual(["5", "4", "<3", "<3", "9"]);
    expect(out.some((r) => r.value.includes(" de "))).toBe(false);
  });

  it("con cupo agrega «de N» a los números y nunca a los enmascarados", () => {
    const out = founderSeatRows(rows, 10);
    expect(out.map((r) => r.value)).toEqual(["5 de 10", "4 de 10", "<3", "<3", "9"]);
  });

  it("el total no lleva cupo (el cupo es por carrera)", () => {
    const total = founderSeatRows(rows, 10).at(-1)!;
    expect(total.key).toBe(FOUNDER_TOTAL_KEY);
    expect(total.value).toBe("9");
  });

  it("ordena por personas, luego «sin carrera» y al final el total", () => {
    expect(founderSeatRows(rows, null).map((r) => r.key)).toEqual([
      "backend",
      "frontend",
      "qa",
      FOUNDER_NO_CAREER_KEY,
      FOUNDER_TOTAL_KEY,
    ]);
  });

  it("un cupo inválido (0, negativo, decimal) se ignora como si no hubiera", () => {
    for (const bad of [0, -2, 2.5, Number.NaN]) {
      expect(founderSeatRows(rows, bad)[0]!.value).toBe("5");
    }
  });

  it("usa el rótulo que pasa el llamador y, si no, la clave legible", () => {
    const out = founderSeatRows(rows, null, (k) => (k === "backend" ? "Backend" : null));
    expect(out.find((r) => r.key === "backend")!.label).toBe("Backend");
    expect(out.find((r) => r.key === "frontend")!.label).toBe("frontend");
    expect(out.find((r) => r.key === FOUNDER_NO_CAREER_KEY)!.label).toBe("Sin carrera");
    expect(out.find((r) => r.key === FOUNDER_TOTAL_KEY)!.label).toBe("Total");
  });

  it("sin filas devuelve una lista vacía", () => {
    expect(founderSeatRows([], 10)).toEqual([]);
  });
});
