import { describe, expect, it } from "vitest";
import { parseBullets, validateHistory } from "./history";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const base = { kind: "trabajo", organization: "Empresa A", title: "Cargo Ficticio" };

describe("validateHistory", () => {
  it("acepta una entrada mínima y una completa", () => {
    expect(validateHistory(form(base))).toMatchObject({ ok: true });
    expect(
      validateHistory(
        form({
          ...base,
          startMonth: "2022-03",
          endMonth: "2024-01",
          bullets: "Uno\n\n Dos \r\nTres",
        }),
      ),
    ).toEqual({
      ok: true,
      value: {
        ...base,
        startMonth: "2022-03",
        endMonth: "2024-01",
        bullets: ["Uno", "Dos", "Tres"],
      },
    });
  });

  it("devuelve el campo que falló, sin el valor", () => {
    expect(validateHistory(form({ ...base, kind: "hobby" }))).toEqual({ ok: false, field: "kind" });
    expect(validateHistory(form({ ...base, organization: " " }))).toEqual({
      ok: false,
      field: "organization",
    });
    expect(validateHistory(form({ ...base, title: "x".repeat(121) }))).toEqual({
      ok: false,
      field: "title",
    });
    expect(validateHistory(form({ ...base, startMonth: "2022-13" }))).toEqual({
      ok: false,
      field: "startMonth",
    });
    expect(validateHistory(form({ ...base, endMonth: "2024-01" }))).toEqual({
      ok: false,
      field: "dates",
    });
    expect(validateHistory(form({ ...base, startMonth: "2024-05", endMonth: "2024-01" }))).toEqual({
      ok: false,
      field: "dates",
    });
  });

  it("empresa y cargo rechazan links, dominios sueltos y emails (SEC-C25-1/2)", () => {
    for (const bad of [
      "https://ejemplo.test/x",
      "miweb.dev",
      "yo@ejemplo.test",
      "www.ejemplo.test",
    ]) {
      expect(validateHistory(form({ ...base, organization: bad }))).toEqual({
        ok: false,
        field: "organization",
      });
      expect(validateHistory(form({ ...base, title: bad }))).toEqual({
        ok: false,
        field: "title",
      });
    }
    expect(validateHistory(form({ ...base, organization: "Node.js SA" })).ok).toBe(true);
  });

  it("viñetas: 6, 220 caracteres, sin links, dominios ni emails", () => {
    const seis = Array.from({ length: 6 }, (_, i) => `v${i}`).join("\n");
    expect(validateHistory(form({ ...base, bullets: seis })).ok).toBe(true);
    for (const bullets of [
      `${seis}\nv7`,
      "x".repeat(221),
      "Mirá https://ejemplo.test/x",
      "Mirá miweb.dev",
      "Escribime a yo@ejemplo.test",
    ]) {
      expect(validateHistory(form({ ...base, bullets })), bullets).toEqual({
        ok: false,
        field: "bullets",
      });
    }
    expect(validateHistory(form({ ...base, bullets: "x".repeat(220) })).ok).toBe(true);
  });

  it("parseBullets ignora vacías", () => {
    expect(parseBullets("\n  \n")).toEqual([]);
    expect(parseBullets(null)).toEqual([]);
  });
});
