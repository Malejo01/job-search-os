import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "../evaluator/checklist";
import { fieldKeyOf, repeatedFields, repeatedForField, type OpenOfferTable } from "./repeated";

const item = (
  id: string,
  over: Partial<ChecklistItem> & Pick<ChecklistItem, "status">,
): ChecklistItem =>
  ({
    kind: id.startsWith("skill:") ? "skill" : "estructurado",
    nivel: "must",
    evidencia: null,
    pide: "Pide algo",
    tenes: null,
    fuente: { pide: "fuente", tenes: null },
    bloquea: false,
    id,
    ...over,
  }) as ChecklistItem;

const offer = (jobId: string, items: ChecklistItem[]): OpenOfferTable => ({ jobId, items });

describe("fieldKeyOf", () => {
  it("campos del perfil y habilidades; el resto no tiene campo", () => {
    expect(fieldKeyOf("ingles")).toBe("ingles");
    expect(fieldKeyOf("anos")).toBe("anos");
    expect(fieldKeyOf("skill:excel")).toBe("skill:excel");
    expect(fieldKeyOf("modalidad")).toBeNull();
    expect(fieldKeyOf("req:2")).toBeNull();
    expect(fieldKeyOf("salario")).toBeNull();
  });
});

describe("repeatedForField", () => {
  const sinIngles = (id: string) => offer(id, [item("ingles", { status: "no_se_sabe" })]);

  it("cuenta N de M: ofertas donde el campo no coincide o está sin confirmar", () => {
    const offers = [
      sinIngles("a"),
      sinIngles("b"),
      offer("c", [item("ingles", { status: "cumple", tenes: "B2" })]),
      offer("d", [item("anos", { status: "cumple", tenes: "3" })]),
    ];
    const r = repeatedForField(offers, "ingles");
    expect(r).toMatchObject({ field: "ingles", n: 2, m: 4 });
    expect(r.jobIds).toEqual(["a", "b"]);
  });

  it("«No coincide» con dato explícito del perfil también cuenta", () => {
    const r = repeatedForField(
      [offer("a", [item("ingles", { status: "no_cumple", tenes: "A2" })])],
      "ingles",
    );
    expect(r.n).toBe(1);
  });

  it("una oferta cuenta una sola vez aunque repita la fila", () => {
    const r = repeatedForField(
      [
        offer("a", [
          item("ingles", { status: "no_se_sabe" }),
          item("ingles", { status: "no_se_sabe" }),
        ]),
      ],
      "ingles",
    );
    expect(r.n).toBe(1);
  });

  it("las ofertas sin tabla no entran en M", () => {
    const r = repeatedForField([sinIngles("a"), offer("b", [])], "ingles");
    expect(r).toMatchObject({ n: 1, m: 1 });
  });

  it("habilidad por slug", () => {
    const r = repeatedForField(
      [
        offer("a", [item("skill:excel", { status: "no_se_sabe" })]),
        offer("b", [item("skill:sql", { status: "no_se_sabe" })]),
      ],
      "skill:excel",
    );
    expect(r).toMatchObject({ n: 1, m: 2 });
  });
});

describe("repeatedFields", () => {
  it("solo lo repetido (N >= 2), de mayor a menor, con desempate estable", () => {
    const offers = [
      offer("a", [
        item("ingles", { status: "no_se_sabe" }),
        item("anos", { status: "no_se_sabe" }),
      ]),
      offer("b", [
        item("ingles", { status: "no_se_sabe" }),
        item("anos", { status: "no_se_sabe" }),
      ]),
      offer("c", [item("ingles", { status: "no_cumple", tenes: "A1" })]),
      offer("d", [item("pais", { status: "no_se_sabe" })]),
    ];
    const r = repeatedFields(offers);
    expect(r.map((x) => [x.field, x.n, x.m])).toEqual([
      ["ingles", 3, 4],
      ["anos", 2, 4],
    ]);
  });

  it("sin ofertas: vacío", () => {
    expect(repeatedFields([])).toEqual([]);
  });
});
