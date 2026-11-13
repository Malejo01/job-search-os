import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CriteriaRules } from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPT_VERSIONS } from "./client";
import { demoEvaluation } from "./demo";
import { createFakeLlm } from "./fake";
import {
  actionFamily,
  buildProfile,
  estimateUsd,
  formatMarkdown,
  resumirPorCarrera,
  runCalidad,
  selectCases,
  type CalidadDeps,
  type CarreraDoc,
  type PersonaDePrueba,
} from "./carreras-calidad";

// Harness R9-6 con el modelo mockeado: cero llamadas pagas. Todo inventado (Empresa A…).
const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(resolve(HERE, "../../../..", rel), "utf8"));
const CARRERAS = [
  "abogacia",
  "administracion_empresas",
  "comunicacion",
  "finanzas_contabilidad",
  "fullstack",
  "marketing_digital",
  "relaciones_internacionales",
  "relaciones_publicas",
];
const docs = CARRERAS.map((c) =>
  read(`packages/pipeline/test/fixtures/carreras/${c}.json`),
) as CarreraDoc[];
const rules = read("packages/db/seeds/criteria.example.json") as CriteriaRules;
const persona: PersonaDePrueba = {
  key: "p",
  role: "abogacia",
  cefr: "B2",
  skills: [{ slug: "x", level: 2 }],
};
const promptRef = DEFAULT_PROMPT_VERSIONS.evaluate_job ?? "evaluate_job@v1";

function deps(over: Partial<CalidadDeps> = {}, score = 8) {
  const llm = createFakeLlm({
    evaluate_job: (vars: Record<string, unknown>) => ({
      ...demoEvaluation(vars as never),
      score,
      bloqueadores_duros: [],
    }),
  });
  const d: CalidadDeps = {
    llm,
    rules,
    promptRef,
    skillNames: { x: "Skill X" },
    roleLabels: {},
    personas: { p: persona },
    personaDeCarrera: Object.fromEntries(CARRERAS.map((c) => [c, "p"])),
    maxUsd: 1,
    expectedCallUsd: 0.01,
    ...over,
  };
  return { d, llm };
}
const profileOf = (doc: CarreraDoc, p: PersonaDePrueba) =>
  buildProfile(doc, p, { x: "Skill X" }, "Rol X");

describe("selectCases", () => {
  it("elige 3 avisos por carrera, todos de categorías que llegan al modelo", () => {
    for (const doc of docs) {
      const c = selectCases(doc);
      expect(c, doc.meta.carrera).toHaveLength(3);
      expect(c.every((x) => x.etiquetas.prefiltro === "must_pass")).toBe(true);
      expect(new Set(c.map((x) => x.categoria)).size).toBe(3);
    }
    expect(docs.flatMap((d) => selectCases(d))).toHaveLength(24);
  });
});

describe("buildProfile", () => {
  it("usa ubicación y años del golden y las skills de la persona, no su texto libre", () => {
    const p = buildProfile(docs[0]!, persona, { x: "Skill X" }, "Abogacía");
    expect(p.locationCountry).toBe("AR");
    expect(p.locationCity).toBe("Salta");
    expect(p.yearsTotal).toBe(2);
    expect(p.remoteOnly).toBe(false);
    expect(p.profileSummary).toContain("Skill X (intermedio)");
    expect(p.targetRoleLabel).toBe("Abogacía");
  });
});

describe("runCalidad", () => {
  it("evalúa las 24 combinaciones con el modelo mockeado y resume por carrera", async () => {
    const { d, llm } = deps();
    const s = await runCalidad(d, docs, 3, profileOf);
    expect(s.resultados).toHaveLength(24);
    expect(s.cortadoPorTope).toBe(false);
    // Solo llaman al modelo los que pasan el prefiltro: ninguno de estos lo descarta
    expect(llm.calls).toHaveLength(24);
    expect(llm.calls.every((c) => c.task === "evaluate_job")).toBe(true);
    const res = resumirPorCarrera(s.resultados);
    expect(res).toHaveLength(8);
    expect(res.every((r) => r.casos === 3)).toBe(true);
    expect(formatMarkdown(s, { modelo: "fake", prompt: promptRef })).toContain("| abogacia |");
  });

  it("el tope duro corta antes de pasarse: con 0,025 y 0,01 por llamada, 2 llamadas", async () => {
    const { d, llm } = deps({ maxUsd: 0.025 });
    // El fake informa costo 0: se lo cambia por el costo esperado para ejercitar el tope
    const priced: typeof d.llm = {
      async generateStructured(...args) {
        const r = await llm.generateStructured(...args);
        return r.ok ? { ok: true, value: { ...r.value, costUsd: 0.01 } } : r;
      },
    };
    const s = await runCalidad({ ...d, llm: priced }, docs, 3, profileOf);
    expect(llm.calls).toHaveLength(2);
    expect(s.cortadoPorTope).toBe(true);
  });

  it("compara contra el rango esperado: dentro, a ±1 y fuera", async () => {
    const doc = docs[0]!;
    const caso = selectCases(doc)[0]!;
    const { min, max } = caso.etiquetas.score_esperado;
    const inside = await runCalidad(deps({}, min).d, [doc], 1, profileOf);
    expect(inside.resultados[0]).toMatchObject({ scoreEnRango: true, scoreLaxo: true });
    const far = await runCalidad(deps({}, Math.max(0, min - 3)).d, [doc], 1, profileOf);
    expect(far.resultados[0]).toMatchObject({ scoreEnRango: false, scoreLaxo: false });
    expect(max).toBeGreaterThanOrEqual(min);
  });

  it("sin persona para una carrera, falla antes de llamar", async () => {
    const { d, llm } = deps({ personaDeCarrera: {} });
    await expect(runCalidad(d, docs, 3, profileOf)).rejects.toThrow(/sin persona/);
    expect(llm.calls).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("actionFamily junta aplicar y postular", () => {
    expect(actionFamily("aplicar")).toBe("postular");
    expect(actionFamily("aplicar_personalizado")).toBe("postular");
    expect(actionFamily("guardar")).toBe("guardar");
    expect(actionFamily("descartar")).toBe("descartar");
  });
  it("estimateUsd: 24 llamadas de 4100/450 tokens a 1,5/9 USD por millón", () => {
    expect(estimateUsd(24, { in: 4100, out: 450 }, { input: 1.5, output: 9 })).toBeCloseTo(
      0.2448,
      3,
    );
  });
});
