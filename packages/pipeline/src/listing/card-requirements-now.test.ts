import { describe, expect, it } from "vitest";
import { cardItemsNow, cardRequirements, type CardChecklistItem } from "./card-requirements";

const it1 = (
  over: Partial<CardChecklistItem> & Pick<CardChecklistItem, "id">,
): CardChecklistItem => ({
  kind: "texto",
  nivel: "must",
  status: "no_se_sabe",
  bloquea: false,
  tenes: null,
  pide: "Pide algo",
  ...over,
});

describe("cardItemsNow (R31-07)", () => {
  it("sin respuestas ni datos nuevos devuelve las mismas filas", () => {
    const items = [it1({ id: "req:1" })];
    expect(cardItemsNow(items, {})).toBe(items);
  });

  it("una respuesta «Sí» saca la fila de «Sin confirmar» de la tarjeta", () => {
    const items = [
      it1({
        id: "req:1",
        pide: "Portugués intermedio",
        pregunta: { clave: "idioma:portugues:intermedio" },
      }),
      it1({ id: "req:2", pide: "Carnet de conducir", pregunta: { clave: "otro:carnet" } }),
    ];
    const answers = new Map([["idioma:portugues:intermedio", { valor: "si" as const }]]);
    const now = cardItemsNow(items, { answers });
    expect(cardRequirements(now).unconfirmed.map((r) => r.pide)).toEqual(["Carnet de conducir"]);
  });

  it("«No» pasa a «No coincide» con dato explícito; «En parte» sigue sin confirmar", () => {
    const items = [
      it1({ id: "req:1", pregunta: { clave: "otro:a" } }),
      it1({ id: "req:2", pregunta: { clave: "otro:b" } }),
    ];
    const answers = new Map([
      ["otro:a", { valor: "no" as const }],
      ["otro:b", { valor: "en_parte" as const, nota: "algo" }],
    ]);
    const now = cardItemsNow(items, { answers });
    expect(now[0]).toMatchObject({ status: "no_cumple" });
    expect(now[1]).toMatchObject({ status: "no_se_sabe" });
  });

  it("el inglés cargado en el perfil resuelve la fila de inglés", () => {
    const items = [it1({ id: "ingles", kind: "estructurado", pide: "Inglés avanzado" })];
    const now = cardItemsNow(items, { facts: { englishCefr: "C1" } });
    expect(now[0]).toMatchObject({ status: "cumple", tenes: "C1" });
    expect(cardRequirements(now).unconfirmed).toEqual([]);
  });

  it("las filas sin pregunta no cambian con las respuestas", () => {
    const items = [it1({ id: "pais", kind: "estructurado" })];
    const now = cardItemsNow(items, { answers: new Map([["otro:a", { valor: "si" as const }]]) });
    expect(now[0]).toEqual(items[0]);
  });
});
