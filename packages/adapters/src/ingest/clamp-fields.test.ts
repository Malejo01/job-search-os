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

  it("deja igual lo que ya entra y conserva los null", () => {
    expect(clampRawJobFields(base)).toEqual(base);
    expect(clampRawJobFields({ ...base, locationRaw: null }).locationRaw).toBeNull();
  });
});
