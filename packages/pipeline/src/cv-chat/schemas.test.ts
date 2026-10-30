import { describe, expect, it } from "vitest";
import { parseCvExtraction } from "./schemas";

describe("parseCvExtraction", () => {
  it("acepta lo que cumple el esquema y limpia los textos", () => {
    const r = parseCvExtraction("duties", { duties: ["  • armé reportes https://x.example  "] });
    expect(r).toEqual({ ok: true, value: { duties: ["Armé reportes"] } });
  });

  it("no capitaliza nombres ni skills", () => {
    expect(parseCvExtraction("skills", { skills: ["sql", "node.js"] })).toEqual({
      ok: true,
      value: { skills: ["sql", "node.js"] },
    });
  });

  it("rechaza campos de más, tipos y faltantes", () => {
    expect(parseCvExtraction("target", { target: "x", phone: "1" }).ok).toBe(false);
    expect(parseCvExtraction("target", {}).ok).toBe(false);
    expect(parseCvExtraction("more_work", { more: "si" }).ok).toBe(false);
    expect(parseCvExtraction("target", null).ok).toBe(false);
    expect(parseCvExtraction("target", "texto").ok).toBe(false);
  });

  it("rechaza fechas mal formadas o desordenadas y «actual» con fin", () => {
    expect(
      parseCvExtraction("dates", { startMonth: "2021-13", endMonth: null, isCurrent: false }).ok,
    ).toBe(false);
    expect(
      parseCvExtraction("dates", { startMonth: "2022-01", endMonth: "2021-01", isCurrent: false })
        .ok,
    ).toBe(false);
    expect(
      parseCvExtraction("dates", { startMonth: "2021-01", endMonth: "2022-01", isCurrent: true })
        .ok,
    ).toBe(false);
    expect(
      parseCvExtraction("dates", { startMonth: "2021-01", endMonth: "2022-01", isCurrent: false })
        .ok,
    ).toBe(true);
  });

  it("rechaza topes de cantidad y largo, y texto que queda vacío al limpiar", () => {
    expect(parseCvExtraction("duties", { duties: [] }).ok).toBe(false);
    expect(parseCvExtraction("duties", { duties: ["a", "b", "c", "d", "e"] }).ok).toBe(false);
    expect(
      parseCvExtraction("skills", { skills: Array.from({ length: 41 }, (_, i) => `s${i}`) }).ok,
    ).toBe(false);
    expect(parseCvExtraction("target", { target: "x".repeat(500) }).ok).toBe(false);
    expect(parseCvExtraction("target", { target: "https://x.example" }).ok).toBe(false);
  });

  it("links: solo http(s)", () => {
    const ok = { linkedin: "https://example.com/in/a", github: null, portfolio: null };
    expect(parseCvExtraction("links", ok).ok).toBe(true);
    expect(parseCvExtraction("links", { ...ok, github: "javascript:alert(1)" }).ok).toBe(false);
  });
});
