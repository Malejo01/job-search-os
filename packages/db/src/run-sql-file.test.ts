import { describe, expect, it } from "vitest";
import { asRehearsal } from "./run-sql-file";

describe("run-sql-file · ensayo", () => {
  it("cambia solo el último COMMIT por ROLLBACK", () => {
    const out = asRehearsal("BEGIN;\n-- COMMIT; en un comentario\nSELECT 1;\nCOMMIT;\n");
    expect(out).toContain("-- COMMIT; en un comentario");
    expect(out.trimEnd().endsWith("ROLLBACK;")).toBe(true);
  });

  it("falla si el archivo no termina en COMMIT", () => {
    expect(() => asRehearsal("BEGIN;\nSELECT 1;\n")).toThrow(/COMMIT/);
  });
});
