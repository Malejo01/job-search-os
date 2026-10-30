import { describe, expect, it } from "vitest";
import { buildSql, changedRows } from "./renorm-companies";

describe("JS-086 · re-normalización de empresas", () => {
  it("solo devuelve las filas cuya normalización cambia", () => {
    const rows = changedRows([
      { id: "1", raw: "Delta Labs", current: "delta" },
      { id: "2", raw: "Delta Labs", current: "delta labs" },
      { id: "3", raw: "Acme Group S.A. (vía Bumeran)", current: "acme" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(rows[0]).toMatchObject({ newNorm: "delta labs", displayName: "Delta Labs" });
    expect(rows[1]!.displayName).toBe("Acme Group S.A.");
  });

  it("escapa comillas y deja el SQL en una transacción", () => {
    const sql = buildSql(
      [
        {
          id: "00000000-0000-0000-0000-000000000001",
          newNorm: "o'neil labs",
          displayName: "O'Neil Labs",
        },
      ],
      [],
      "2026-10-30",
    );
    expect(sql).toContain("'o''neil labs'");
    expect(sql).toContain("-- renorm_jobs: sin filas para cambiar");
    expect(sql.trim().startsWith("--")).toBe(true);
    expect(sql).toMatch(/BEGIN;[\s\S]*COMMIT;\s*$/);
  });
});
