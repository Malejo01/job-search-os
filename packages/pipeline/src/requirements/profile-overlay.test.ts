import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../evaluator/checklist";
import { parseProfileFieldUpdate, withCurrentProfileFacts } from "./profile-overlay";

const item = (over: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "pide">): ChecklistItem =>
  ({
    kind: "estructurado",
    nivel: "must",
    evidencia: null,
    status: "no_se_sabe",
    tenes: null,
    fuente: { pide: "modelo", tenes: null },
    bloquea: false,
    ...over,
  }) as ChecklistItem;

describe("withCurrentProfileFacts", () => {
  it("inglés: sin dato pasa a «cumple» o «no cumple» con el CEFR nuevo, sin tocar lo demás", () => {
    const base = {
      items: [
        item({ id: "ingles", pide: "Inglés avanzado" }),
        item({ id: "modalidad", pide: "Modalidad remoto", status: "cumple" }),
      ],
    };
    const ok = withCurrentProfileFacts(base, { englishCefr: "C1" });
    expect(ok.items[0]).toMatchObject({ status: "cumple", tenes: "C1" });
    expect(ok.items[0]?.fuente.tenes).toBe("perfil");
    expect(ok.items[1]).toBe(base.items[1]);
    const bajo = withCurrentProfileFacts(base, { englishCefr: "A2" });
    expect(bajo.items[0]).toMatchObject({ status: "no_cumple", tenes: "A2" });
  });

  it("inglés con un nivel ilegible o ausente: no cambia nada", () => {
    const base = { items: [item({ id: "ingles", pide: "Inglés avanzado" })] };
    expect(withCurrentProfileFacts(base, { englishCefr: null })).toBe(base);
    expect(withCurrentProfileFacts(base, { englishCefr: "hola" }).items[0]?.status).toBe(
      "no_se_sabe",
    );
  });

  it("años: compara el número del pedido con los años del perfil", () => {
    const base = { items: [item({ id: "anos", pide: "3 años de ventas" })] };
    expect(withCurrentProfileFacts(base, { yearsTotal: 5 }).items[0]).toMatchObject({
      status: "cumple",
      tenes: "5 años",
    });
    expect(withCurrentProfileFacts(base, { yearsTotal: 1 }).items[0]).toMatchObject({
      status: "no_cumple",
      tenes: "1 años",
    });
  });

  it("años: si el pedido no trae un número legible, no se inventa", () => {
    const base = { items: [item({ id: "anos", pide: "Experiencia previa" })] };
    expect(withCurrentProfileFacts(base, { yearsTotal: 5 }).items[0]?.status).toBe("no_se_sabe");
  });

  it("sin datos nuevos devuelve la misma tabla", () => {
    const base = { items: [item({ id: "ingles", pide: "Inglés básico" })] };
    expect(withCurrentProfileFacts(base, {})).toBe(base);
  });
});

describe("parseProfileFieldUpdate", () => {
  it("acepta inglés CEFR, años y país ISO-2; nada más", () => {
    expect(parseProfileFieldUpdate({ field: "ingles", value: "b2" })).toEqual({
      ok: true,
      update: { field: "ingles", value: "B2" },
    });
    expect(parseProfileFieldUpdate({ field: "anos", value: "4,5" })).toEqual({
      ok: true,
      update: { field: "anos", value: 4.5 },
    });
    expect(parseProfileFieldUpdate({ field: "pais", value: "ar" })).toEqual({
      ok: true,
      update: { field: "pais", value: "AR" },
    });
  });

  it("rechaza lo inválido y los campos que no son de este modal", () => {
    for (const bad of [
      { field: "ingles", value: "D1" },
      { field: "anos", value: "-1" },
      { field: "anos", value: "80" },
      { field: "anos", value: "abc" },
      { field: "pais", value: "ARG" },
      { field: "email", value: "x@example.com" },
      { field: "ingles" },
      null,
    ]) {
      expect(parseProfileFieldUpdate(bad).ok).toBe(false);
    }
  });
});
