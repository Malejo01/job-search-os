import { describe, expect, it } from "vitest";
import { planFirstIngestNetwork } from "./first-ingest";

// Entorno con el que playwright.config.ts levanta el server del e2e
const E2E_ENV = { DB_TARGET: "local", LLM_DEMO: "1" };

describe("planFirstIngestNetwork", () => {
  it("con el entorno de e2e la primera ingesta no sale a la red", () => {
    expect(planFirstIngestNetwork(E2E_ENV, { poolSources: [], extraSources: [] })).toEqual({
      getOnBoard: false,
      extraSources: [],
      skippedForDemo: true,
    });
  });

  it("con el entorno de e2e tampoco sale a la red aunque haya fuentes extra o pool definidos", () => {
    expect(
      planFirstIngestNetwork(
        { ...E2E_ENV, INGEST_EXTRA_SOURCES: "torre", POOL_SOURCES: "greenhouse" },
        { poolSources: ["greenhouse"], extraSources: ["torre"] },
      ),
    ).toEqual({ getOnBoard: false, extraSources: [], skippedForDemo: true });
  });

  it("LLM_DEMO distinto de '1' no cuenta como modo demo", () => {
    for (const LLM_DEMO of ["0", "", "true", " 1"]) {
      expect(
        planFirstIngestNetwork({ LLM_DEMO }, { poolSources: [], extraSources: ["torre"] }),
      ).toEqual({ getOnBoard: true, extraSources: ["torre"], skippedForDemo: false });
    }
  });

  it("sin modo demo y con getonboard fuera del pool, corre la ingesta por usuario de Get on Board", () => {
    expect(planFirstIngestNetwork({}, { poolSources: [], extraSources: [] })).toEqual({
      getOnBoard: true,
      extraSources: [],
      skippedForDemo: false,
    });
    expect(
      planFirstIngestNetwork({}, { poolSources: ["greenhouse", "wwr"], extraSources: [] }),
    ).toEqual({ getOnBoard: true, extraSources: [], skippedForDemo: false });
  });

  it("sin modo demo y con getonboard en el pool, no la repite por usuario", () => {
    expect(planFirstIngestNetwork({}, { poolSources: ["getonboard"], extraSources: [] })).toEqual({
      getOnBoard: false,
      extraSources: [],
      skippedForDemo: false,
    });
  });

  it("sin modo demo pasa las fuentes extra tal cual", () => {
    expect(
      planFirstIngestNetwork({}, { poolSources: ["getonboard"], extraSources: ["torre"] }),
    ).toEqual({ getOnBoard: false, extraSources: ["torre"], skippedForDemo: false });
  });

  it("no devuelve la misma lista que recibe (el llamador puede mutarla)", () => {
    const extraSources = ["torre"];
    const plan = planFirstIngestNetwork({}, { poolSources: [], extraSources });
    expect(plan.extraSources).not.toBe(extraSources);
  });
});
