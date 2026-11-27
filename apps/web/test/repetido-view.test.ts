import { describe, expect, it } from "vitest";
import type { ChecklistItem } from "@job-search-os/pipeline";
import { editableField, repetidoView } from "../app/(app)/jobs/[id]/repetido-view";

const sinConfirmar = (id: string): ChecklistItem =>
  ({
    id,
    kind: "estructurado",
    nivel: "must",
    evidencia: null,
    pide: "Pide algo",
    status: "no_se_sabe",
    tenes: null,
    fuente: { pide: "modelo", tenes: null },
    bloquea: false,
  }) as ChecklistItem;

const oferta = (jobId: string, id: string) => ({ jobId, items: [sinConfirmar(id)] });

describe("repetidoView", () => {
  it("se muestra con N >= 2 y el texto sale con los números", () => {
    const v = repetidoView(
      [oferta("a", "ingles"), oferta("b", "ingles"), oferta("c", "anos")],
      "ingles",
    );
    expect(v?.textos.frase).toBe("Esto mismo te pasa en 2 de tus 3 ofertas");
    expect(v?.textos.boton).toBe("Actualizar mi inglés");
    expect(v?.textos.inglesOpciones).toHaveLength(6);
  });

  it("con una sola oferta no se muestra", () => {
    expect(repetidoView([oferta("a", "ingles"), oferta("b", "anos")], "ingles")).toBeNull();
  });

  it("datos que no se editan en un campo (habilidades, autorización) no abren modal", () => {
    expect(editableField("skill:excel")).toBeNull();
    expect(editableField("autorizacion")).toBeNull();
    expect(editableField(null)).toBeNull();
    expect(
      repetidoView([oferta("a", "autorizacion"), oferta("b", "autorizacion")], "autorizacion"),
    ).toBeNull();
  });
});
