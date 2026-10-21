import { describe, expect, it } from "vitest";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import type { CriteriaRules } from "@job-search-os/pipeline";
import type { LlmClient } from "../llm/types";
import { evaluateForProfile, targetRoleLabelFor, unexpectedError } from "./evaluate-job";

describe("targetRoleLabelFor", () => {
  it("prioriza el puesto del pool, luego el principal de la lista, luego el puesto único", () => {
    expect(
      targetRoleLabelFor("marketing_digital", { targetRoles: ["qa"], targetRole: "ux_ui" }),
    ).toBe("Marketing digital");
    expect(
      targetRoleLabelFor(null, { targetRoles: ["marketing_digital", "qa"], targetRole: "ux_ui" }),
    ).toBe("Marketing digital");
    expect(
      targetRoleLabelFor(undefined, { targetRoles: [], targetRole: "marketing_digital" }),
    ).toBe("Marketing digital");
  });

  it("ignora valores que no son un puesto conocido y devuelve null si no queda ninguno", () => {
    expect(targetRoleLabelFor("inventado", { targetRoles: ["marketing_digital"] })).toBe(
      "Marketing digital",
    );
    expect(targetRoleLabelFor("inventado", { targetRoles: ["otro"], targetRole: null })).toBeNull();
    expect(targetRoleLabelFor(null, {})).toBeNull();
  });
});

describe("evaluateForProfile: modalidades aceptadas", () => {
  const evaluation = {
    score: 8,
    confianza: "alta",
    years_required: 2,
    location_ok: "ok",
    modalidad: "hibrido",
    disciplina: "ai_engineer",
    ingles_requerido: "intermedio",
    tipo_empresa: "producto",
    paises_permitidos: ["AR"],
    match_fuerte: [],
    gaps: [],
    bloqueadores_duros: ["Modalidad híbrida"],
    senales_positivas: [],
    veredicto: "ok",
    accion_sugerida: "aplicar",
    riesgos: [],
    years_domain: null,
    years_discipline: null,
  };
  const llm = {
    generateStructured: async (_task: string, schema: { parse: (v: unknown) => unknown }) => ({
      ok: true as const,
      value: {
        object: schema.parse(evaluation),
        model: "test",
        provider: "test",
        promptVersion: "evaluate_job@v1.3.4",
        usage: { inputTokens: null, outputTokens: null, reasoningTokens: null },
        costUsd: null,
        latencyMs: 0,
        usedFallback: false,
      },
    }),
  } as unknown as LlmClient;
  const profile = {
    locationCountry: "AR",
    remoteOnly: false,
    workAuth: { us: false, eu: false },
  };
  const run = (extra: { remoteOnly: boolean; acceptedModalities?: string[] }) =>
    evaluateForProfile({
      llm,
      promptVersion: "evaluate_job@v1.3.4",
      profile: { ...profile, ...extra },
      rules: criteria as CriteriaRules,
      job: { title: "Rol A", companyRaw: "Empresa A", jdText: "Descripción inventada." },
    });

  it("pasa las modalidades del perfil a decide()", async () => {
    const acepta = await run({ remoteOnly: false, acceptedModalities: ["remoto", "hibrido"] });
    expect(acepta.ok && acepta.decision.bloqueadores).toEqual([]);
    expect(acepta.ok && acepta.decision.accion).toBe("aplicar");
    const solo = await run({ remoteOnly: true, acceptedModalities: ["remoto"] });
    expect(solo.ok && solo.decision.accion).toBe("descartar");
  });
  it("sin acceptedModalities (demo) se deriva de remoteOnly", async () => {
    const r = await run({ remoteOnly: false });
    expect(r.ok && r.decision.bloqueadores).toEqual([]);
  });
});

describe("unexpectedError", () => {
  it("una excepción con texto de JD no llega al error del outcome", () => {
    const e = Object.assign(new Error("Failed query: insert ... params: TEXTO-DEL-JD"), {
      name: "DrizzleQueryError",
      cause: Object.assign(new Error("TEXTO-DEL-JD"), {
        name: "PostgresError",
        code: "23505",
        constraint_name: "jobs_pkey",
      }),
    });
    const out = unexpectedError(e);
    expect(out).toBe("PostgresError 23505 jobs_pkey");
    expect(out).not.toContain("TEXTO-DEL-JD");
    expect(unexpectedError(new Error("TEXTO-DEL-JD"))).toBe("Error");
    expect(unexpectedError("TEXTO-DEL-JD")).toBe("UnknownError");
  });
});
