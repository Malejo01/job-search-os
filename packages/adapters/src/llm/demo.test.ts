import { outputSchemaFor } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { memoryCallSink } from "./calls";
import { createDemoLlm, DEMO_MODEL, demoEvaluation } from "./demo";

const vars = (job: string) => ({
  profile_summary: "AI Engineer con RAG y agentes",
  constraints: "remoto, Argentina",
  criteria: "criterios",
  job,
  had_full_jd: true,
});

describe("modo demo (FakeLlm contra la cola real)", () => {
  it("cumple el schema v1 (gaps string) y v1.1+ (gaps tipados) y se identifica como fake", async () => {
    const calls = memoryCallSink();
    const llm = createDemoLlm({ calls });
    const job =
      "AI Engineer remoto para LATAM. RAG, agentes, Python, TypeScript, MCP. Deseable AWS. 5 años. Salario USD 4000.";
    for (const ref of ["evaluate_job@v1", "evaluate_job@v1.1", "evaluate_job@v1.2"] as const) {
      const r = await llm.generateStructured("evaluate_job", outputSchemaFor(ref), vars(job), {
        promptVersion: ref,
        jobId: "j1",
        userId: "u1",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.value.model).toBe(DEMO_MODEL);
      expect(r.value.object.veredicto).toMatch(/^DEMO/);
      expect(r.value.object.score).toBeGreaterThanOrEqual(7);
      // v1 no tiene riesgos en el schema: la salida los pierde (EvaluationSchema los pone en [])
      if (ref !== "evaluate_job@v1") {
        expect(r.value.object.riesgos).toContain("LATAM sin países listados");
      }
      // v1 recibe gaps como strings y EvaluationSchema los normaliza a must; v1.1+ conserva el nivel
      expect(r.value.object.gaps).toEqual([
        { skill: "cloud", nivel: ref === "evaluate_job@v1" ? "must" : "deseable" },
      ]);
    }
    expect(calls.calls).toHaveLength(3);
    expect(calls.calls[0]).toMatchObject({ model: "fake", costUsd: 0, label: "demo", ok: true });
  });

  it("detecta bloqueadores verificables (años, presencial, solo EE.UU.) y descarta", () => {
    const e = demoEvaluation(
      vars("Senior ML Engineer, on-site in Austin, US only. 10+ years. Python."),
    );
    expect(e.bloqueadores_duros).toEqual(
      expect.arrayContaining([
        "piden 10+ años de experiencia",
        "presencial",
        "solo residentes de EE.UU.",
      ]),
    );
    expect(e.location_ok).toBe("no");
    expect(e.accion_sugerida).toBe("descartar");
  });

  it("solo evalúa evaluate_job", async () => {
    const r = await createDemoLlm().generateStructured(
      "extract_skills",
      outputSchemaFor("evaluate_job@v1"),
      vars("x"),
    );
    expect(r).toMatchObject({ ok: false, error: { kind: "no_route" } });
  });
});
