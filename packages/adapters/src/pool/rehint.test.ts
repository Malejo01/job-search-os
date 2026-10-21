import { describe, expect, it } from "vitest";
import { formatRehintReport, parseRehintArgs } from "./rehint";

describe("parseRehintArgs", () => {
  it("por defecto es dry-run local", () => {
    expect(parseRehintArgs([])).toEqual({ ok: true, apply: false, remote: false });
  });
  it("acepta --apply y --remote", () => {
    expect(parseRehintArgs(["--apply", "--remote"])).toEqual({
      ok: true,
      apply: true,
      remote: true,
    });
  });
  it("rechaza argumentos desconocidos", () => {
    expect(parseRehintArgs(["--force"]).ok).toBe(false);
  });
});

describe("formatRehintReport", () => {
  it("imprime solo conteos", () => {
    const text = formatRehintReport({
      total: 3,
      hintsChanged: 2,
      langChanged: 1,
      rowsWritten: 0,
      byRoleBefore: { product_manager: 0, producto_proyectos: 2 },
      byRoleAfter: { product_manager: 2, producto_proyectos: 0 },
      byLangBefore: { "(sin dato)": 1 },
      byLangAfter: { es: 1 },
      legacyMatrix: [{ from: "producto_proyectos", to: "product_manager", count: 2 }],
    });
    expect(text).toContain("role_hints a cambiar: 2");
    expect(text).toContain("product_manager: 2");
    expect(text).toContain("es");
  });
});
