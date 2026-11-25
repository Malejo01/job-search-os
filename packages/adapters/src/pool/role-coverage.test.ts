import { describe, expect, it } from "vitest";
import {
  formatRoleLanguageCoverage,
  maskCell,
  parseCoverageArgs,
  type RoleLanguageRow,
} from "./role-coverage";

describe("maskCell", () => {
  it("0 tal cual, de 1 a 4 «<5», desde 5 el número", () => {
    expect(maskCell(0)).toBe("0");
    expect(maskCell(1)).toBe("<5");
    expect(maskCell(4)).toBe("<5");
    expect(maskCell(5)).toBe("5");
    expect(maskCell(120)).toBe("120");
  });
});

describe("formatRoleLanguageCoverage", () => {
  const rows: RoleLanguageRow[] = [
    { role: "abogacia", es: 3, en: 1, other: 0, unknown: 0 },
    { role: "marketing_digital", es: 40, en: 22, other: 2, unknown: 6 },
  ];
  const out = formatRoleLanguageCoverage(rows, {
    label: "jobsearch (localhost, solo lectura)",
    asOf: new Date("2026-11-25T12:00:00Z"),
  });

  it("lleva la fecha, la base y las celdas chicas enmascaradas", () => {
    expect(out).toContain("fecha: 2026-11-25");
    expect(out).toContain("base: jobsearch (localhost, solo lectura)");
    const abogacia = out.split("\n").find((l) => l.startsWith("abogacia"))!;
    expect(abogacia).toContain("<5");
    expect(abogacia).not.toMatch(/\b[1-4]\b/);
  });

  it("ordena de mayor a menor total", () => {
    const lines = out.split("\n");
    expect(lines.findIndex((l) => l.startsWith("marketing_digital"))).toBeLessThan(
      lines.findIndex((l) => l.startsWith("abogacia")),
    );
  });
});

describe("parseCoverageArgs · falla cerrado", () => {
  it("sin DB_TARGET=local ni flags no corre", () => {
    const r = parseCoverageArgs([], {});
    expect(r.ok).toBe(false);
  });

  it("con DB_TARGET=local usa la base local de desarrollo", () => {
    expect(parseCoverageArgs([], { DB_TARGET: "local" })).toEqual({
      ok: true,
      target: { kind: "local", db: "dev" },
    });
  });

  it("--local y --db snapshot", () => {
    expect(parseCoverageArgs(["--local", "--db", "snapshot"], {})).toEqual({
      ok: true,
      target: { kind: "local", db: "snapshot" },
    });
  });

  it("--solo-lectura habilita la remota", () => {
    expect(parseCoverageArgs(["--solo-lectura"], {})).toEqual({
      ok: true,
      target: { kind: "remote-readonly" },
    });
  });

  it("no mezcla local y remota, ni acepta argumentos desconocidos", () => {
    expect(parseCoverageArgs(["--solo-lectura", "--local"], {}).ok).toBe(false);
    expect(parseCoverageArgs(["--solo-lectura"], { DB_TARGET: "local" }).ok).toBe(false);
    expect(parseCoverageArgs(["--apply"], { DB_TARGET: "local" }).ok).toBe(false);
    expect(parseCoverageArgs(["--db", "prod"], { DB_TARGET: "local" }).ok).toBe(false);
  });
});
