import { readFileSync } from "node:fs";
import { loadPrompt, renderPrompt } from "@job-search-os/prompts";
import {
  CV_CHAT_MAX_COST_USD,
  CV_CHAT_MAX_INPUT_CHARS,
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  CV_CHAT_MAX_TURNS,
  cvWriteVars,
  verifyCvBullets,
  type CvHistoryInput,
} from "@job-search-os/pipeline";
import { describe, expect, it } from "vitest";
import { anthropicRequestFor } from "./fallback-request.util";
import { cvCostUsd, runPersona, stepUsd, tokensOf, type PersonaRun } from "./estimate";
import { PERSONAS } from "./personas.fixtures";

type Route = {
  task: string;
  max_tokens: number;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  fallback_model: string;
  fallback_input_usd_per_mtok: number;
  fallback_output_usd_per_mtok: number;
};
const routes = JSON.parse(
  readFileSync(new URL("../../../db/seeds/model_routing.json", import.meta.url), "utf8"),
) as Route[];
const route = (task: string) => routes.find((r) => r.task === task)!;

const GEMINI = { inUsd: 1.5, outUsd: 9 };
const HAIKU = { inUsd: 1, outUsd: 5 };
const SONNET = { inUsd: 2, outUsd: 10 };

let runs: PersonaRun[] = [];

describe("CVC-6 · estimado sin red del CV conversacional", () => {
  it("las 6 entrevistas del fake cierran el checklist y recorren los temas", async () => {
    runs = [];
    for (const p of PERSONAS) runs.push(await runPersona(p));
    expect(runs).toHaveLength(6);
    for (const r of runs) {
      expect(r.complete, r.id).toBe(true);
      expect(r.turns, r.id).toBeGreaterThanOrEqual(10);
      expect(r.turns, r.id).toBeLessThan(CV_CHAT_MAX_TURNS);
      // una llamada por turno más la redacción
      expect(r.steps.filter((s) => s.task === "cv_interview")).toHaveLength(r.turns);
      expect(r.steps.filter((s) => s.task === "cv_write")).toHaveLength(1);
    }
  });

  it("el DOCX de cada persona pasa el test de ATS: es DOCX, el texto sale y están las secciones estándar", () => {
    for (const r of runs) {
      expect(r.docx.isDocx, r.id).toBe(true);
      expect(r.docx.sections, r.id).toEqual(
        expect.arrayContaining(["Experiencia", "Educación", "Skills"]),
      );
      expect(r.docx.text, r.id).toContain("• ");
      expect(r.docx.text, r.id).not.toMatch(/\t/); // sin tablas
    }
  });

  it("con el fake, el verificador no descarta nada (devuelve las respuestas de la persona)", () => {
    for (const r of runs) {
      expect(r.bullets, r.id).toBeGreaterThan(0);
      expect(r.bulletsFromPerson, r.id).toBe(0);
    }
  });

  it("el verificador descarta el 100 % de las viñetas con una cifra, un nombre o una tecnología inventados", () => {
    const sources = ["Empresa A", "Analista", "Armé reportes en SQL para 12 sucursales"];
    const hostile = [
      "Armé reportes en SQL para 40 sucursales",
      "Armé reportes en SQL para Empresa Z",
      "Armé reportes en SQL con Kubernetes",
    ];
    const out = verifyCvBullets(
      hostile.map((g) => ({ generated: g, person: "Armé reportes en SQL para 12 sucursales" })),
      sources,
    );
    // las tres caen al texto de la persona (deduplicado a una sola viñeta) y ninguna es del modelo
    expect(out.every((o) => o.origin === "person")).toBe(true);
  });

  it("costo por CV con Gemini Flash y con el respaldo (tokens = caracteres / 4)", () => {
    const rows = runs.map((r) => ({
      id: r.id,
      turns: r.turns,
      gemini: cvCostUsd(r, GEMINI, GEMINI),
      respaldo: cvCostUsd(r, HAIKU, SONNET),
    }));
    // Cota amplia: el costo de un CV completo es de centavos, muy por debajo del tope de USD 0,15
    for (const x of rows) {
      expect(x.gemini, x.id).toBeLessThan(CV_CHAT_MAX_COST_USD);
      expect(x.respaldo, x.id).toBeLessThan(CV_CHAT_MAX_COST_USD);
    }
  });
});

it("resumen del estimado: turnos, tokens por turno y costo por CV dentro de lo documentado en informe-cvc6", () => {
  const rows = runs.map((r) => {
    const iv = r.steps.filter((s) => s.task === "cv_interview");
    const w = r.steps.find((s) => s.task === "cv_write")!;
    const inAvg = iv.reduce((t, s) => t + tokensOf(s.inChars), 0) / iv.length;
    const outAvg = iv.reduce((t, s) => t + tokensOf(s.outChars), 0) / iv.length;
    return {
      id: r.id,
      turns: r.turns,
      inAvg: Math.round(inAvg),
      outAvg: Math.round(outAvg),
      inMax: Math.max(...iv.map((s) => tokensOf(s.inChars))),
      writeIn: tokensOf(w.inChars),
      writeOut: tokensOf(w.outChars),
      bullets: r.bullets,
      gemini: cvCostUsd(r, GEMINI, GEMINI).toFixed(4),
      respaldo: cvCostUsd(r, HAIKU, SONNET).toFixed(4),
      secciones: r.docx.sections.join("/"),
    };
  });
  // Dos grupos: una experiencia (12 turnos) y dos (18); la mayor parte del costo es el prompt fijo
  expect(rows.map((r) => r.turns).sort((a, b) => a - b)).toEqual([12, 12, 12, 18, 18, 18]);
  for (const r of rows) {
    expect(r.inAvg).toBeGreaterThan(700);
    expect(r.inAvg).toBeLessThan(900);
    expect(r.outAvg).toBeLessThan(60);
    expect(Number(r.gemini)).toBeGreaterThan(0.015);
    expect(Number(r.gemini)).toBeLessThan(0.035);
    expect(Number(r.respaldo)).toBeLessThan(Number(r.gemini));
  }
});

describe("CVC-6 · calibración de las reservas de gasto (S-1): el máximo del paso, no el promedio", () => {
  /** Peor prompt de la entrevista: el mensaje más largo que acepta la ruta y un contexto de trabajo largo. */
  function maxInterviewInputTokens(): number {
    const p = loadPrompt("cv_interview@v1");
    if (!p.ok) throw new Error("sin prompt");
    const r = renderPrompt(p.value, {
      lang: "es",
      topic: "organization",
      context: `${"x".repeat(120)} | ${"y".repeat(120)}`,
      message: "m".repeat(CV_CHAT_MAX_INPUT_CHARS),
    });
    if (!r.ok) throw new Error("no renderiza");
    return tokensOf(r.value.length);
  }

  /** Peor prompt de la redacción: 6 trabajos con 4 respuestas de 220 caracteres, y el contexto lleno. */
  function maxWriteInputTokens(): number {
    const history: CvHistoryInput[] = Array.from({ length: 6 }, () => ({
      kind: "trabajo" as const,
      organization: "o".repeat(120),
      title: "t".repeat(120),
      startMonth: "2020-01",
      endMonth: null,
      bullets: Array.from({ length: 4 }, () => "b".repeat(220)),
    }));
    const vars = cvWriteVars({
      lang: "es",
      target: "p".repeat(120),
      history: [
        ...history,
        ...Array.from({ length: 5 }, () => ({
          kind: "educacion" as const,
          organization: "i".repeat(120),
          title: "e".repeat(120),
          startMonth: null,
          endMonth: null,
          bullets: [],
        })),
      ],
      skills: Array.from({ length: 40 }, () => "s".repeat(60)),
      languages: Array.from({ length: 6 }, () => "l".repeat(40)),
    });
    const p = loadPrompt("cv_write@v1");
    if (!p.ok) throw new Error("sin prompt");
    const r = renderPrompt(p.value, vars);
    if (!r.ok) throw new Error("no renderiza");
    return tokensOf(r.value.length);
  }

  /** Máximo de un paso: el primario agotando `max_tokens` y, si falla, el respaldo agotando el suyo. */
  async function maxStepUsd(task: "cv_interview" | "cv_write", inTokens: number): Promise<number> {
    const r = route(task);
    const primary = stepUsd(inTokens, r.max_tokens, {
      inUsd: r.input_usd_per_mtok,
      outUsd: r.output_usd_per_mtok,
    });
    const sent = await anthropicRequestFor(r.fallback_model, r.max_tokens);
    const fallback = stepUsd(inTokens, sent.max_tokens ?? r.max_tokens, {
      inUsd: r.fallback_input_usd_per_mtok,
      outUsd: r.fallback_output_usd_per_mtok,
    });
    return primary + fallback;
  }

  it("la reserva por turno cubre el máximo del paso (primario + respaldo) sin exagerar", async () => {
    const max = await maxStepUsd("cv_interview", maxInterviewInputTokens());
    expect(CV_CHAT_TURN_RESERVE_USD).toBeGreaterThanOrEqual(max);
    expect(CV_CHAT_TURN_RESERVE_USD).toBeLessThanOrEqual(max * 1.25);
  });

  it("la reserva de la redacción cubre el máximo del paso (primario + respaldo) sin exagerar", async () => {
    const max = await maxStepUsd("cv_write", maxWriteInputTokens());
    expect(CV_CHAT_WRITE_RESERVE_USD).toBeGreaterThanOrEqual(max);
    expect(CV_CHAT_WRITE_RESERVE_USD).toBeLessThanOrEqual(max * 1.25);
  });

  it("el promedio medido queda muy por debajo de la reserva", () => {
    const interview = runs.flatMap((r) => r.steps.filter((s) => s.task === "cv_interview"));
    const avg =
      interview.reduce(
        (t, s) => t + stepUsd(tokensOf(s.inChars), tokensOf(s.outChars), GEMINI),
        0,
      ) / interview.length;
    expect(avg).toBeLessThan(CV_CHAT_TURN_RESERVE_USD / 2);
  });
});
