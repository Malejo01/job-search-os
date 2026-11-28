import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "@job-search-os/pipeline";
import { encajaView } from "../app/(app)/jobs/[id]/como-encaja-view";

const item = (over: Partial<ChecklistItem> & Pick<ChecklistItem, "id" | "status">) =>
  ({
    kind: "estructurado",
    nivel: "must",
    evidencia: null,
    pide: "Pide algo",
    tenes: "dato",
    fuente: { pide: "fuente", tenes: "perfil" },
    bloquea: false,
    ...over,
  }) as ChecklistItem;

describe("encajaView", () => {
  it("sin tabla: vacío", () => {
    expect(encajaView(null).verdict).toBe("vacio");
    expect(encajaView({ items: [] }).rows).toEqual([]);
  });

  it("condición excluyente que no coincide manda el veredicto y va aparte", () => {
    const v = encajaView({
      items: [
        item({ id: "modalidad", status: "cumple" }),
        item({ id: "residencia", status: "no_cumple", bloquea: true, pide: "Residir en EE. UU." }),
      ],
    });
    expect(v.verdict).toBe("excluyente");
    expect(v.blocking?.pide).toBe("Residir en EE. UU.");
    expect(v.rows[0]!.id).toBe("residencia");
  });

  it("sin dato del perfil es «sin confirmar», nunca «no coincide»", () => {
    const v = encajaView({
      items: [item({ id: "anos", status: "no_cumple", tenes: null })],
    });
    expect(v.verdict).toBe("sinConfirmar");
    expect(v.blocking).toBeNull();
    expect(v.rows[0]!.state).toBe("sinConfirmar");
  });

  it("todo coincide; hasta 3 filas", () => {
    const v = encajaView({
      items: ["a", "b", "c", "d"].map((id) => item({ id: `req:${id}`, status: "cumple" })),
    });
    expect(v.verdict).toBe("coincide");
    expect(v.rows).toHaveLength(3);
  });

  it("una habilidad deseable que no coincide no baja el veredicto", () => {
    const v = encajaView({
      items: [
        item({ id: "ingles", status: "cumple" }),
        item({ id: "skill:x", kind: "skill", nivel: "deseable", status: "no_cumple" }),
      ],
    });
    expect(v.verdict).toBe("coincide");
  });
});
