import { describe, expect, it, vi } from "vitest";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { buildChecklist, compileTaxonomy, type CriteriaRules } from "@job-search-os/pipeline";
import type * as Pipeline from "@job-search-os/pipeline";
import type { LlmClient } from "../llm/types";
import type { Logger } from "../logger";
import { evaluateForProfile, targetRoleLabelFor, unexpectedError } from "./evaluate-job";

// buildChecklist real por defecto; un test lo hace tirar una vez (R-O7)
vi.mock("@job-search-os/pipeline", async (orig) => {
  const m = await orig<typeof Pipeline>();
  return { ...m, buildChecklist: vi.fn(m.buildChecklist) };
});

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

  it("traduce la clave anterior producto_proyectos y rotula las carreras de producto", () => {
    expect(targetRoleLabelFor("producto_proyectos", {})).toBe("Product Manager");
    expect(targetRoleLabelFor(null, { targetRoles: ["producto_proyectos"] })).toBe(
      "Product Manager",
    );
    expect(targetRoleLabelFor("product_owner", {})).toBe("Product Owner");
    expect(targetRoleLabelFor("project_manager", {})).toBe("Project Manager / Scrum");
    expect(targetRoleLabelFor("product_marketing", {})).toBe("Product Marketing");
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

describe("evaluateForProfile: checklist y jobFacts", () => {
  const evaluation = {
    score: 8,
    confianza: "alta",
    years_required: 3,
    location_ok: "ok",
    modalidad: "remoto",
    disciplina: "ai_engineer",
    ingles_requerido: "avanzado",
    tipo_empresa: "producto",
    paises_permitidos: ["AR"],
    match_fuerte: [],
    gaps: [],
    bloqueadores_duros: [],
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
  const run = (
    job: Partial<Parameters<typeof evaluateForProfile>[0]["job"]>,
    extra: Partial<Parameters<typeof evaluateForProfile>[0]> = {},
  ) =>
    evaluateForProfile({
      llm,
      promptVersion: "evaluate_job@v1.3.4",
      profile: {
        locationCountry: "AR",
        remoteOnly: true,
        workAuth: { us: false, eu: false },
        yearsTotal: 5,
        englishCefr: "B2",
      },
      rules: criteria as CriteriaRules,
      job: { title: "Rol A", companyRaw: "Empresa A", jdText: "Descripción inventada.", ...job },
      checklistSkills: {
        skillLevels: new Map([["python", 3]]),
        userSkills: [],
        terms: compileTaxonomy([{ slug: "python", name: "Python", aliases: [] }]),
      },
      ...extra,
    });

  it("devuelve el checklist y pasa los hechos del aviso a decide()", async () => {
    const r = await run({
      jdText: "Python en equipo internacional. Excellent English required.",
      salaryMinUsd: 2000,
      salaryMaxUsd: 2500,
      salaryPeriod: "mensual",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decision.bloqueadores).toHaveLength(1);
    expect(r.decision.bloqueadores[0]).toMatch(/^salario publicado por debajo del piso/);
    expect(r.checklist?.items.find((i) => i.id === "salario")).toMatchObject({
      status: "no_cumple",
      bloquea: true,
    });
    expect(r.checklist?.items.find((i) => i.id === "skill:python")?.status).toBe("cumple");
    expect(r.checklist?.descarte_rapido?.id).toBe("ingles");
  });

  it("si buildChecklist tira, la evaluación sigue sin checklist y se loguea sin datos", async () => {
    vi.mocked(buildChecklist).mockImplementationOnce(() => {
      throw new Error("TEXTO-DEL-JD");
    });
    const errors: Array<[unknown, string]> = [];
    const logger = { error: (o: unknown, m: string) => errors.push([o, m]) } as unknown as Logger;
    const r = await run({ jdText: "Python." }, { logger, ctx: { userId: "u-1", jobId: "j-1" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.checklist).toBeNull();
    expect(r.decision.accion).toBeDefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]![0]).toEqual({ user_id: "u-1", job_id: "j-1", error: "Error" });
    expect(JSON.stringify(errors)).not.toContain("TEXTO-DEL-JD");
  });

  it("sin skills cargadas (demo) el checklist sale igual, sin ítems de skills", async () => {
    const r = await evaluateForProfile({
      llm,
      promptVersion: "evaluate_job@v1.3.4",
      profile: { locationCountry: "AR", remoteOnly: true, workAuth: { us: false, eu: false } },
      rules: criteria as CriteriaRules,
      job: { title: "Rol A", companyRaw: "Empresa A", jdText: "Python." },
    });
    expect(r.ok && r.checklist?.items.some((i) => i.kind === "skill")).toBe(false);
    expect(r.ok && r.checklist?.items.length).toBeGreaterThan(0);
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
