import { describe, expect, it } from "vitest";
import { applyChips, chipCounts, matchesChip, type ChipContext, type ChipRow } from "./chips";

const row = (over: Partial<ChipRow> = {}): ChipRow => ({
  title: "Analista",
  modality: "presencial",
  locationRaw: null,
  countriesAllowed: null,
  lang: null,
  seniority: null,
  ...over,
});
const ctx: ChipContext = { city: "Ciudad Ficticia", country: "AR" };

describe("matchesChip", () => {
  it("remoto: solo modality remoto", () => {
    expect(matchesChip("remoto", row({ modality: "remoto" }), ctx)).toBe(true);
    expect(matchesChip("remoto", row({ modality: "hibrido" }), ctx)).toBe(false);
    expect(matchesChip("remoto", row({ modality: "desconocida" }), ctx)).toBe(false);
  });

  it("en mi ciudad: el lugar del aviso nombra la ciudad, sin mayúsculas ni acentos", () => {
    expect(matchesChip("cerca", row({ locationRaw: "CIUDAD FICTICIA, Argentina" }), ctx)).toBe(
      true,
    );
    expect(
      matchesChip("cerca", row({ locationRaw: "Villa Ñandú" }), {
        city: "villa nandu",
        country: "AR",
      }),
    ).toBe(true);
    expect(matchesChip("cerca", row({ locationRaw: "Otra Ciudad" }), ctx)).toBe(false);
    expect(matchesChip("cerca", row({ locationRaw: null }), ctx)).toBe(false);
    expect(
      matchesChip("cerca", row({ locationRaw: "Ciudad Ficticia" }), { city: null, country: "AR" }),
    ).toBe(false);
  });

  it("aceptan mi país: solo lo explícito en countries_allowed", () => {
    expect(matchesChip("pais", row({ countriesAllowed: ["AR"] }), ctx)).toBe(true);
    expect(matchesChip("pais", row({ countriesAllowed: ["LATAM"] }), ctx)).toBe(true);
    expect(matchesChip("pais", row({ countriesAllowed: null }), ctx)).toBe(false);
    expect(matchesChip("pais", row({ countriesAllowed: ["US"] }), ctx)).toBe(false);
    expect(
      matchesChip("pais", row({ countriesAllowed: ["AR"] }), { city: null, country: null }),
    ).toBe(false);
  });

  it("en español: solo avisos con idioma guardado es", () => {
    expect(matchesChip("espanol", row({ lang: "es" }), ctx)).toBe(true);
    expect(matchesChip("espanol", row({ lang: "en" }), ctx)).toBe(false);
    expect(matchesChip("espanol", row({ lang: null }), ctx)).toBe(false);
  });

  it("para empezar: nivel inicial por la columna o el título", () => {
    expect(matchesChip("inicio", row({ seniority: "Junior" }), ctx)).toBe(true);
    expect(matchesChip("inicio", row({ title: "Dev Jr" }), ctx)).toBe(true);
    expect(matchesChip("inicio", row({ title: "Senior Dev" }), ctx)).toBe(false);
  });
});

describe("applyChips y chipCounts", () => {
  const rows = [
    { id: "a", ...row({ modality: "remoto", lang: "es", countriesAllowed: ["AR"] }) },
    { id: "b", ...row({ modality: "remoto", lang: "en" }) },
    { id: "c", ...row({ modality: "presencial", lang: "es" }) },
  ];

  it("sin chips activos devuelve todo", () => {
    expect(applyChips(rows, ctx, [])).toHaveLength(3);
  });

  it("los chips activos se combinan (todos tienen que cumplirse)", () => {
    expect(applyChips(rows, ctx, ["remoto", "espanol"]).map((r) => r.id)).toEqual(["a"]);
  });

  it("cada chip cuenta cuántas ofertas quedarían si se activa", () => {
    expect(chipCounts(rows, ctx, [])).toEqual({
      remoto: 2,
      cerca: 0,
      pais: 1,
      espanol: 2,
      inicio: 0,
    });
    expect(chipCounts(rows, ctx, ["remoto"])).toEqual({
      remoto: 2,
      cerca: 0,
      pais: 1,
      espanol: 1,
      inicio: 0,
    });
  });
});
