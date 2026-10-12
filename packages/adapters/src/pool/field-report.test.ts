import { describe, expect, it } from "vitest";
import { fieldPresence, formatFieldReport } from "./field-report";

describe("fieldPresence", () => {
  const items = [
    { a: "x", b: 1, c: [1], d: { k: 1 }, e: true },
    { a: "", b: null, c: [], d: undefined, e: false },
    { a: "y", b: "2" },
    "no es objeto",
    null,
    [1, 2],
  ];

  it("cuenta presencia ignorando null, undefined y cadena vacía", () => {
    const rows = fieldPresence(items, ["a", "b"]);
    expect(rows[0]).toEqual({ field: "a", present: 2, types: { string: 2 } });
    expect(rows[1]).toEqual({ field: "b", present: 2, types: { number: 1, string: 1 } });
  });

  it("distingue array, object y boolean; un array vacío o false cuentan como presentes", () => {
    const rows = fieldPresence(items, ["c", "d", "e"]);
    expect(rows[0]).toEqual({ field: "c", present: 2, types: { array: 2 } });
    expect(rows[1]).toEqual({ field: "d", present: 1, types: { object: 1 } });
    expect(rows[2]).toEqual({ field: "e", present: 2, types: { boolean: 2 } });
  });

  it("campo ausente en todos → 0; lista vacía de items → 0", () => {
    expect(fieldPresence(items, ["zzz"])).toEqual([{ field: "zzz", present: 0, types: {} }]);
    expect(fieldPresence([], ["a"])).toEqual([{ field: "a", present: 0, types: {} }]);
  });
});

describe("formatFieldReport", () => {
  it("muestra conteo, porcentaje y tipos, sin valores", () => {
    const items = [{ titulo: "Texto Secreto 1" }, { titulo: "Texto Secreto 2" }, {}, {}];
    const text = formatFieldReport(fieldPresence(items, ["titulo", "otro"]), items.length);
    expect(text).toContain("titulo  2/4 (50%)  string=2");
    expect(text).toContain("otro    0/4 (0%)");
    expect(text).not.toContain("Secreto");
  });

  it("total 0 no divide por cero; sin filas devuelve un aviso", () => {
    expect(formatFieldReport([{ field: "a", present: 0, types: {} }], 0)).toContain("0/0 (0%)");
    expect(formatFieldReport([], 0)).toBe("(sin campos)");
  });
});
