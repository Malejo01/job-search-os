import { describe, expect, it } from "vitest";
import {
  careersWithFewOffers,
  FEW_OFFERS_THRESHOLD,
  languageNoun,
  offersInLanguage,
} from "./few-offers";

describe("offersInLanguage", () => {
  const v = { role: "abogacia", total: 12, writtenInSpanish: 3 };

  it("en español cuenta solo las escritas en español", () => {
    expect(offersInLanguage(v, "es")).toBe(3);
  });

  it("en inglés cuenta las que no están en español", () => {
    expect(offersInLanguage(v, "en")).toBe(9);
  });

  it("con los dos idiomas cuenta todas", () => {
    expect(offersInLanguage(v, "both")).toBe(12);
  });

  it("nunca da negativo si los datos no cierran", () => {
    expect(offersInLanguage({ role: "x", total: 2, writtenInSpanish: 5 }, "en")).toBe(0);
  });
});

describe("careersWithFewOffers", () => {
  it("el umbral es 5: con 5 ya no hay aviso", () => {
    expect(FEW_OFFERS_THRESHOLD).toBe(5);
    const at = (n: number) => [{ role: "abogacia", total: n, writtenInSpanish: n }];
    expect(careersWithFewOffers(at(4), "es")).toEqual([{ role: "abogacia", count: 4 }]);
    expect(careersWithFewOffers(at(5), "es")).toEqual([]);
  });

  it("una carrera sin ofertas también cuenta como «pocas»", () => {
    expect(
      careersWithFewOffers([{ role: "comunicacion", total: 0, writtenInSpanish: 0 }], "es"),
    ).toEqual([{ role: "comunicacion", count: 0 }]);
  });

  it("mide en el idioma de la persona: mucho inglés no alcanza a quien pide español", () => {
    const volumes = [{ role: "relaciones_publicas", total: 40, writtenInSpanish: 2 }];
    expect(careersWithFewOffers(volumes, "es")).toEqual([
      { role: "relaciones_publicas", count: 2 },
    ]);
    expect(careersWithFewOffers(volumes, "both")).toEqual([]);
  });

  it("deja afuera las carreras que alcanzan y conserva el orden", () => {
    const out = careersWithFewOffers(
      [
        { role: "a", total: 9, writtenInSpanish: 9 },
        { role: "b", total: 1, writtenInSpanish: 1 },
        { role: "c", total: 3, writtenInSpanish: 3 },
      ],
      "es",
    );
    expect(out.map((c) => c.role)).toEqual(["b", "c"]);
  });

  it("sin carreras no hay aviso", () => {
    expect(careersWithFewOffers([], "es")).toEqual([]);
  });
});

describe("languageNoun", () => {
  it("dice el idioma como lo lee la persona", () => {
    expect(languageNoun("es")).toBe("español");
    expect(languageNoun("en")).toBe("inglés");
    expect(languageNoun("both")).toBe("español e inglés");
  });
});
