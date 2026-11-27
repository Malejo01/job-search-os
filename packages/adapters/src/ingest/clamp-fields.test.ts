import type { RawJob } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { clampRawJobFields } from "./clamp-fields";

const base: RawJob = {
  source: { kind: "other", name: "Fuente", externalId: "x:1", url: null, rawRef: null },
  title: "Analista",
  companyRaw: "Empresa A",
  locationRaw: "Córdoba",
  countriesAllowed: null,
  modality: "desconocida",
  contractType: null,
  salaryMinUsd: null,
  salaryMaxUsd: null,
  salaryPeriod: null,
  salaryNote: null,
  weeklyHours: null,
  candidatesCount: null,
  badges: [],
  jdText: null,
  postedAt: null,
  tags: [],
  seniority: null,
  lang: null,
};

describe("clampRawJobFields", () => {
  it("recorta título, empresa y ubicación a 300 caracteres", () => {
    const long = "a".repeat(1_000_000);
    const out = clampRawJobFields({ ...base, title: long, companyRaw: long, locationRaw: long });
    expect(out.title).toHaveLength(300);
    expect(out.companyRaw).toHaveLength(300);
    expect(out.locationRaw).toHaveLength(300);
  });

  it("recorta la nota de sueldo a 200", () => {
    expect(clampRawJobFields({ ...base, salaryNote: "b".repeat(5_000) }).salaryNote).toHaveLength(
      200,
    );
  });

  it("recorta el contrato a 100, y países y etiquetas por cantidad y por largo", () => {
    const out = clampRawJobFields({
      ...base,
      contractType: "c".repeat(5_000),
      countriesAllowed: Array.from({ length: 5_000 }, () => "p".repeat(500)),
      badges: Array.from({ length: 5_000 }, () => "b".repeat(500)),
    });
    expect(out.contractType).toHaveLength(100);
    expect(out.countriesAllowed).toHaveLength(250);
    expect(out.countriesAllowed![0]).toHaveLength(40);
    expect(out.badges).toHaveLength(20);
    expect(out.badges[0]).toHaveLength(100);
  });

  it("2 MB en cada campo se recortan en menos de 100 ms", () => {
    const huge = "z".repeat(2_000_000);
    const start = performance.now();
    clampRawJobFields({
      ...base,
      title: huge,
      companyRaw: huge,
      locationRaw: huge,
      contractType: huge,
      salaryNote: huge,
      countriesAllowed: [huge],
      badges: [huge],
    });
    expect(performance.now() - start).toBeLessThan(100);
  });

  it("deja igual lo que ya entra y conserva los null", () => {
    expect(clampRawJobFields(base)).toEqual(base);
    expect(clampRawJobFields({ ...base, locationRaw: null }).locationRaw).toBeNull();
  });

  it("R32-08: el sueldo original se vuelve a validar antes de llegar a la base", () => {
    const ok = { min: 1_200_000, max: 1_500_000, currency: "ARS", period: "mensual" as const };
    expect(clampRawJobFields({ ...base, salaryOriginal: ok }).salaryOriginal).toEqual(ok);
    // moneda mal escrita, sin moneda o mínimo mayor que el máximo: se descarta entero
    for (const bad of [
      { ...ok, currency: "pesos" },
      { ...ok, currency: "" },
      { ...ok, min: 5, max: 1 },
    ]) {
      expect(clampRawJobFields({ ...base, salaryOriginal: bad }).salaryOriginal).toBeNull();
    }
    expect(clampRawJobFields({ ...base, salaryOriginal: null }).salaryOriginal).toBeNull();
  });
});
