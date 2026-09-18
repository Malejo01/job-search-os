import { describe, expect, it } from "vitest";
import criteria from "../../db/seeds/criteria.example.json";
import type { CriteriaRules } from "./criteria";
import { prefilter } from "./prefilter";
import { parseModality, rawJobFromManual, type ManualJobInput } from "./raw-job";

const rules = criteria as CriteriaRules;
const base: ManualJobInput = {
  url: null,
  title: "AI Engineer",
  company: "Acme",
  locationRaw: null,
  modality: "remoto",
  jdText: null,
};
const flagsOf = (input: ManualJobInput) => {
  const raw = rawJobFromManual(input);
  const pre = prefilter(
    {
      title: raw.title,
      locationRaw: raw.locationRaw,
      modality: raw.modality,
      countriesAllowed: raw.countriesAllowed,
      candidatesCount: raw.candidatesCount,
      badges: raw.badges,
    },
    rules,
  );
  return pre.pass ? pre.flags : [`descartada:${pre.reason}`];
};

describe("rawJobFromManual: la carga manual (UI y MCP) no se salta el riesgo de ubicación", () => {
  it("nunca inventa países permitidos: countriesAllowed queda null", () => {
    expect(rawJobFromManual({ ...base, modality: "remoto" }).countriesAllowed).toBeNull();
    expect(rawJobFromManual({ ...base, modality: "hibrido" }).countriesAllowed).toBeNull();
  });

  it("remoto con 'LATAM' o sin país → location_risk (los casos golden 34 y 16)", () => {
    expect(flagsOf({ ...base, locationRaw: "LATAM (remote)" })).toContain("location_risk");
    expect(flagsOf({ ...base, locationRaw: "Remote" })).toContain("location_risk");
    expect(flagsOf({ ...base, locationRaw: null })).toContain("location_risk");
    expect(rawJobFromManual({ ...base, locationRaw: null }).locationRaw).toBe(
      "remoto (sin país indicado)",
    );
  });

  it("remoto con Argentina explícita o 'anywhere' → sin riesgo", () => {
    expect(flagsOf({ ...base, locationRaw: "Remoto (Argentina)" })).not.toContain("location_risk");
    expect(flagsOf({ ...base, locationRaw: "Work from anywhere" })).not.toContain("location_risk");
  });

  it("presencial o híbrido sin ubicación no inventa un riesgo de país", () => {
    const raw = rawJobFromManual({ ...base, modality: "hibrido", locationRaw: null });
    expect(raw.locationRaw).toBeNull();
    expect(parseModality("presencial")).toBe("presencial");
    expect(parseModality("cualquier cosa")).toBe("desconocida");
  });
});

describe("rawJobFromManual: crudo original (JS-024)", () => {
  it("conserva el input tal cual llegó (sin trim), para guardarlo en raw_blobs antes de procesar", () => {
    const input: ManualJobInput = {
      ...base,
      url: "  https://example.com/jobs/1  ",
      title: "  AI Engineer ",
      jdText: "  Texto pegado con espacios al borde.\r\n",
    };
    const raw = rawJobFromManual(input);
    expect(raw.title).toBe("AI Engineer");
    expect(raw.source.original).toEqual({
      contentType: "application/json",
      body: JSON.stringify(input),
    });
    expect(JSON.parse(raw.source.original!.body)).toEqual(input);
  });
});
