import { describe, expect, it } from "vitest";
import { cardRequirements, type CardChecklistItem } from "./card-requirements";

const item = (over: Partial<CardChecklistItem> & Pick<CardChecklistItem, "id" | "status">) =>
  ({
    kind: "estructurado",
    nivel: "must",
    bloquea: false,
    tenes: "dato del perfil",
    pide: "Pide algo",
    ...over,
  }) as CardChecklistItem;

describe("cardRequirements (R30-04)", () => {
  it("sin checklist o vacío: nada que mostrar", () => {
    for (const x of [null, undefined, []]) {
      expect(cardRequirements(x)).toEqual({ excluding: null, unconfirmed: [] });
    }
  });

  it("condición excluyente que no coincide: sale arriba, con su código y lo que pide", () => {
    const r = cardRequirements([
      item({ id: "residencia", status: "no_cumple", bloquea: true, pide: "Residir en EE. UU." }),
    ]);
    expect(r.excluding).toEqual({ code: "residencia", pide: "Residir en EE. UU." });
  });

  it("un no_cumple sin dato del perfil NO es «No coincide»: queda sin confirmar (regla 2.1)", () => {
    const r = cardRequirements([
      item({
        id: "autorizacion",
        status: "no_cumple",
        bloquea: true,
        tenes: null,
        pide: "Autorización de trabajo en EE. UU.",
      }),
    ]);
    expect(r.excluding).toBeNull();
    expect(r.unconfirmed).toEqual([
      { code: "autorizacion", pide: "Autorización de trabajo en EE. UU." },
    ]);
  });

  it("un deseable o una habilidad que no coincide no es excluyente", () => {
    const r = cardRequirements([
      item({ id: "anos", status: "no_cumple", nivel: "deseable", bloquea: true }),
      item({ id: "skill:react", kind: "skill", status: "no_cumple", bloquea: true }),
    ]);
    expect(r.excluding).toBeNull();
  });

  it("sin confirmar: hasta 2, primero lo excluyente (must) y las habilidades al final", () => {
    const r = cardRequirements([
      item({ id: "skill:go", kind: "skill", nivel: "deseable", status: "no_se_sabe", pide: "Go" }),
      item({ id: "ingles", status: "no_se_sabe", pide: "Inglés avanzado" }),
      item({ id: "anos", status: "no_se_sabe", pide: "5 años" }),
      item({ id: "pais", status: "cumple" }),
    ]);
    expect(r.unconfirmed.map((u) => u.code)).toEqual(["ingles", "anos"]);
  });

  it("lo que coincide no aparece en ninguna línea", () => {
    const r = cardRequirements([item({ id: "pais", status: "cumple" })]);
    expect(r).toEqual({ excluding: null, unconfirmed: [] });
  });
});
