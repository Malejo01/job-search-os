import { describe, expect, it } from "vitest";
import { betaMetricRows, betaMetricsCsv, parseBetaMetrics } from "./beta-metrics";

const RAW = {
  generated_at: "2026-11-09T12:00:00Z",
  k: 3,
  active_7d: null,
  active_30d: 12,
  evaluations_30d: 340,
  verdict_up_30d: 30,
  verdict_down_30d: 10,
  applications_30d: 25,
  interviews_30d: null,
  llm_cost_30d_usd: 4.5,
  llm_cost_per_active_30d_usd: 0.375,
  offers_by_source_30d: { greenhouse_api: 120, getonboard_api: 300 },
  offers_by_lang_30d: { en: 380, es: 40 },
};

describe("métricas de la beta (C-14)", () => {
  it("falla cerrado con una forma inesperada", () => {
    expect(parseBetaMetrics(null)).toBeNull();
    expect(parseBetaMetrics({ ...RAW, active_30d: -1 })).toBeNull();
    expect(parseBetaMetrics({ ...RAW, offers_by_source_30d: [] })).toBeNull();
    // Claves del pool con caracteres raros: no pasan
    expect(parseBetaMetrics({ ...RAW, offers_by_lang_30d: { "=1+1": 3 } })).toBeNull();
  });

  it("lo enmascarado por k-anonimato se muestra como «<k», nunca como 0", () => {
    const rows = betaMetricRows(parseBetaMetrics(RAW)!);
    const value = (metric: string) => rows.find((r) => r.metric === metric)?.value;
    expect(value("Activas en 7 días")).toBe("<3");
    expect(value("Entrevistas u ofertas")).toBe("<3");
    expect(value("Activas en 30 días")).toBe("12");
    expect(value("% de 👍")).toBe("75 %");
    expect(value("Por persona activa (USD)")).toBe("0.375");
    const masked = betaMetricRows(parseBetaMetrics({ ...RAW, llm_cost_30d_usd: null })!);
    expect(masked.find((r) => r.metric === "Total (USD)")?.value).toBe("<3");
  });

  it("con 👍 o 👎 enmascarados, el porcentaje también queda oculto", () => {
    const rows = betaMetricRows(parseBetaMetrics({ ...RAW, verdict_up_30d: null })!);
    expect(rows.find((r) => r.metric === "% de 👍")?.value).toBe("<3");
  });

  it("las fuentes van de la que más ofertas trajo a la que menos", () => {
    const sources = betaMetricRows(parseBetaMetrics(RAW)!).filter((r) =>
      r.group.includes("fuente"),
    );
    expect(sources.map((r) => r.metric)).toEqual(["getonboard_api", "greenhouse_api"]);
  });

  it("el CSV lleva la fecha y k arriba, y neutraliza lo que parece una fórmula", () => {
    const csv = betaMetricsCsv(parseBetaMetrics(RAW)!);
    expect(csv.split("\n")[0]).toBe("# generado 2026-11-09T12:00:00Z · k=3");
    expect(csv).toContain('"grupo","metrica","valor"');
    // «<3» no empieza con un carácter de fórmula y queda tal cual
    expect(csv).toContain('"Personas","Activas en 7 días","<3"');
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m);
  });
});
