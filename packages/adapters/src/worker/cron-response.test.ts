import { describe, expect, it } from "vitest";
import { buildEvaluateCronResponse, classifyCronError, failedOutcomes } from "./cron-response";

const JOB = "0b9a6f3e-1c2d-4e5f-8a7b-123456789abc";

const summary = {
  taken: 5,
  evaluated: 2,
  retried: 1,
  failed: 2,
  skipped: 0,
  userCapped: 0,
  requeuedStale: 0,
  outcomes: [
    { ok: true, jobId: JOB, score: 8 },
    { ok: false, jobId: JOB, error: "generation_failed: 401 para persona@ejemplo.test" },
    { ok: false, jobId: JOB, error: "job sin jd_text: no se evalúa" },
    {
      ok: false,
      jobId: JOB,
      error: `duplicate key value violates unique constraint "evaluations_pkey" (user ${JOB})`,
    },
  ],
};

describe("classifyCronError", () => {
  it("separa llm, validacion y otro", () => {
    expect(classifyCronError("provider_unavailable: timeout")).toBe("llm");
    expect(classifyCronError("job en estado discarded: no se evalúa")).toBe("validacion");
    expect(classifyCronError("usuario sin perfil o criterios activos")).toBe("validacion");
    expect(classifyCronError('relation "x" does not exist')).toBe("otro");
    expect(classifyCronError("")).toBe("otro");
  });

  it("clasifica como llm el formato `kind: código` de JS-123", () => {
    for (const e of [
      "generation_failed: api_call:500",
      "generation_failed: no_object",
      "generation_failed: validation:invalid_type",
      "generation_failed: unknown",
      "aborted: timeout",
      "aborted: aborted",
      "provider_unavailable: provider_unavailable",
      "no_route: sin fila en model_routing para 'evaluate_job'",
    ]) {
      expect(classifyCronError(e)).toBe("llm");
    }
  });
});

describe("buildEvaluateCronResponse", () => {
  it("devuelve conteos y errores por categoría", () => {
    expect(buildEvaluateCronResponse(summary)).toEqual({
      ok: true,
      taken: 5,
      evaluated: 2,
      retried: 1,
      failed: 2,
      skipped: 0,
      userCapped: 0,
      requeuedStale: 0,
      errors: { llm: 1, validacion: 1, otro: 1 },
    });
  });

  it("no filtra emails, uuids ni texto de la base", () => {
    const body = JSON.stringify(buildEvaluateCronResponse(summary));
    expect(body).not.toContain(JOB);
    expect(body).not.toContain("ejemplo.test");
    expect(body).not.toContain("evaluations_pkey");
    expect(body).not.toContain("duplicate key");
    expect(body).not.toContain("jobId");
  });

  it("sin errores no incluye la clave errors", () => {
    const body = buildEvaluateCronResponse({ ...summary, outcomes: [{ ok: true, jobId: JOB }] });
    expect(body).not.toHaveProperty("errors");
  });
});

describe("failedOutcomes", () => {
  it("deja el detalle para el log", () => {
    const f = failedOutcomes(summary.outcomes);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ jobId: JOB, category: "llm" });
  });
});
