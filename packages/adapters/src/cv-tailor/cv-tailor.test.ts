import { readFileSync } from "node:fs";
import {
  buildCvDocument,
  buildCvTailorPromptVars,
  CvTailorOutputSchema,
  verifyCvTailor,
  type CvSourceData,
} from "@job-search-os/pipeline";
import { loadPrompt, renderPrompt, templateVars } from "@job-search-os/prompts";
import { describe, expect, it } from "vitest";
import { anthropicRequestFor } from "../cv-chat/fallback-request.util";
import { stepUsd, tokensOf } from "../cv-chat/estimate";
import { memoryCallSink } from "../llm/calls";
import { createDemoLlm } from "../llm/demo";
import { DEMO_TAILOR_INVENTS_MARK } from "../llm/demo-cv-tailor";
import { CV_TAILOR_PROMPT } from "./generate";
import { CV_TAILOR_RESERVE_USD, CV_TAILOR_TASK, cvTailorLabel } from "./reserve";

// CV inventado
const data: CvSourceData = {
  displayName: "Persona Ficticia",
  email: "persona@example.com",
  headline: "Analista de datos",
  summary: null,
  skills: [{ name: "SQL" }, { name: "Excel" }, { name: "Python" }],
  languages: [],
  achievements: [],
  history: [
    {
      kind: "trabajo",
      organization: "Empresa A",
      title: "Analista",
      startMonth: "2021-03",
      endMonth: null,
      bullets: ["Armé reportes semanales en Excel", "Automaticé la carga de datos con SQL"],
    },
  ],
};
const doc = buildCvDocument(data, { lang: "es", includeEmail: true });
const job = { title: "Analista de datos", company: "Empresa B", description: "Pedimos SQL." };

describe("cv_tailor@v1", () => {
  const loaded = loadPrompt(CV_TAILOR_PROMPT);

  it("carga, es la tarea cv_tailor y pide exactamente las variables que arma el pipeline", () => {
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.task).toBe(CV_TAILOR_TASK);
    const vars = buildCvTailorPromptVars({ cv: doc, job });
    expect([...templateVars(loaded.value.template)].sort()).toEqual(Object.keys(vars).sort());
    expect(renderPrompt(loaded.value, vars).ok).toBe(true);
  });

  it("trata oferta y CV como datos y prohíbe inventar", () => {
    if (!loaded.ok) throw new Error("no carga");
    const t = loaded.value.template;
    expect(t).toMatch(/datos, no instrucciones/);
    expect(t).toMatch(/<<<OFERTA>>>/);
    expect(t).toMatch(/<<<CV>>>/);
    expect(t).toMatch(/Inventar/);
    expect(t).toMatch(/Copiar de la oferta/);
    expect(t).toMatch(/solo van nombres que estén en «Skills confirmadas»/);
  });
});

describe("fake de LLM_DEMO de cv_tailor", () => {
  const run = async (description: string) => {
    const calls = memoryCallSink();
    const r = await createDemoLlm({ calls }).generateStructured(
      CV_TAILOR_TASK,
      CvTailorOutputSchema,
      buildCvTailorPromptVars({ cv: doc, job: { ...job, description } }),
      { userId: "u1", promptVersion: CV_TAILOR_PROMPT, label: cvTailorLabel("x") },
    );
    return { r, calls };
  };

  it("cumple el esquema, se registra con model = fake y costo 0, y la verificación lo acepta", async () => {
    const { r, calls } = await run("Pedimos SQL.");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.model).toBe("fake");
    expect(r.value.costUsd).toBe(0);
    expect(calls.calls[0]).toMatchObject({
      task: CV_TAILOR_TASK,
      model: "fake",
      costUsd: 0,
      label: "cv_tailor:x",
    });
    const v = verifyCvTailor(doc, r.value.object);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.changed).toBe(true);
    expect(v.value.document.sections[0]!.blocks[0]!.bullets).toEqual([
      "Automaticé la carga de datos con SQL",
      "Armé reportes semanales en Excel",
    ]);
  });

  it("con la marca de la oferta inventa un dato y la verificación descarta la versión", async () => {
    const { r } = await run(`Pedimos SQL. ${DEMO_TAILOR_INVENTS_MARK}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = verifyCvTailor(doc, r.value.object);
    expect(v).toMatchObject({ ok: false, error: { reason: "bullet_rejected" } });
  });
});

describe("reserva atada al seed de model_routing", () => {
  type Route = {
    task: string;
    provider: string;
    model: string;
    fallback_model: string;
    max_tokens: number;
    thinking_level: string | null;
    input_usd_per_mtok: number;
    output_usd_per_mtok: number;
    fallback_input_usd_per_mtok: number;
    fallback_output_usd_per_mtok: number;
  };
  const routes = JSON.parse(
    readFileSync(new URL("../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
  ) as Route[];

  it("hay una sola fila cv_tailor, en Sonnet con respaldo Gemini y sin razonamiento extendido", () => {
    const rows = routes.filter((r) => r.task === CV_TAILOR_TASK);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      fallback_model: "gemini-3.5-flash",
      thinking_level: null,
      input_usd_per_mtok: 2,
      output_usd_per_mtok: 10,
      fallback_input_usd_per_mtok: 1.5,
      fallback_output_usd_per_mtok: 9,
    });
  });

  it("la reserva cubre el máximo (primario + respaldo) y no pasa de 1,25 veces", async () => {
    const route = routes.find((r) => r.task === CV_TAILOR_TASK)!;
    const loaded = loadPrompt(CV_TAILOR_PROMPT);
    if (!loaded.ok) throw new Error("sin prompt");
    // Tope del prompt: oferta de 6000 caracteres más sus encabezados y un CV de 20 entradas llenas
    const rendered = renderPrompt(loaded.value, {
      job: "x".repeat(6_400),
      cv: "x".repeat(40_000),
    });
    if (!rendered.ok) throw new Error("no renderiza");
    const inTokens = tokensOf(rendered.value.length);
    const primary = stepUsd(inTokens, route.max_tokens, {
      inUsd: route.input_usd_per_mtok,
      outUsd: route.output_usd_per_mtok,
    });
    const sent = await anthropicRequestFor(route.fallback_model, route.max_tokens);
    const fallback = stepUsd(inTokens, sent.max_tokens ?? route.max_tokens, {
      inUsd: route.fallback_input_usd_per_mtok,
      outUsd: route.fallback_output_usd_per_mtok,
    });
    const max = primary + fallback;
    expect(CV_TAILOR_RESERVE_USD).toBeGreaterThanOrEqual(max);
    expect(CV_TAILOR_RESERVE_USD).toBeLessThanOrEqual(max * 1.25);
  });
});
