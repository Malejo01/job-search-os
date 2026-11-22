import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  INTERVIEW_GOLDEN_SIZE,
  checkInterviewFeedback,
  parseInterviewGolden,
  summarizeInterviewChecks,
  type InterviewGoldenExpect,
} from "./golden";

const feedback = {
  clarity: 8,
  relevance: 9,
  star: 9,
  tip: "Sumá un número al resultado para que se note el impacto de lo que hiciste.",
  example: "Cuando el cierre tardaba dos días, armé [herramienta] y lo bajé a [número] horas.",
};

const expectHigh: InterviewGoldenExpect = {
  clarity: [7, 10],
  relevance: [7, 10],
  star: [8, 10],
};

describe("checkInterviewFeedback", () => {
  it("pasa estricto y laxo cuando todo cae en el rango", () => {
    expect(checkInterviewFeedback(expectHigh, feedback)).toEqual({
      strict: true,
      lax: true,
      failures: [],
    });
  });

  it("un puntaje a 1 punto del rango falla estricto pero pasa laxo", () => {
    const v = checkInterviewFeedback(expectHigh, { ...feedback, star: 7 });
    expect(v.strict).toBe(false);
    expect(v.lax).toBe(true);
    expect(v.failures).toEqual(["star 7 fuera de 8-10"]);
  });

  it("un puntaje a más de 1 punto del rango falla los dos", () => {
    const v = checkInterviewFeedback(expectHigh, { ...feedback, star: 5 });
    expect(v.strict).toBe(false);
    expect(v.lax).toBe(false);
  });

  it("el consejo y el ejemplo no pueden repetir lo que se marcó como prohibido", () => {
    const v = checkInterviewFeedback(
      { ...expectHigh, forbidden: ["42 años"] },
      { ...feedback, tip: "A tus 42 años tenés mucho para contar." },
    );
    expect(v.strict).toBe(false);
    expect(v.lax).toBe(false);
    expect(v.failures).toEqual(['repite un dato que no debía: "42 años"']);
  });

  it("exige marcadores entre corchetes en el ejemplo cuando el caso lo pide", () => {
    const v = checkInterviewFeedback(
      { ...expectHigh, examplePlaceholders: true },
      { ...feedback, example: "Armé un tablero y bajé el cierre a una hora." },
    );
    expect(v.strict).toBe(false);
    expect(v.lax).toBe(false);
    expect(v.failures).toEqual(["el ejemplo no marca con [corchetes] lo que falta"]);
  });

  it("detecta el 10 en todo ante una respuesta que quería forzarlo", () => {
    const v = checkInterviewFeedback(
      { clarity: [0, 6], relevance: [0, 6], star: [0, 6], notAllTens: true },
      { ...feedback, clarity: 10, relevance: 10, star: 10 },
    );
    expect(v.strict).toBe(false);
    expect(v.failures).toContain("puso 10 en todo");
  });
});

describe("summarizeInterviewChecks", () => {
  it("cuenta casos y calcula las tasas estricta y laxa", () => {
    const s = summarizeInterviewChecks([
      { strict: true, lax: true, failures: [] },
      { strict: false, lax: true, failures: ["x"] },
      { strict: false, lax: false, failures: ["y"] },
      { strict: true, lax: true, failures: [] },
    ]);
    expect(s).toEqual({ n: 4, strict: 2, lax: 3, strictRate: 0.5, laxRate: 0.75 });
  });

  it("sin casos no inventa tasas", () => {
    expect(summarizeInterviewChecks([])).toEqual({
      n: 0,
      strict: 0,
      lax: 0,
      strictRate: null,
      laxRate: null,
    });
  });
});

describe("parseInterviewGolden", () => {
  const sample = {
    id: "caso-a",
    context: { kind: "career", career: "Analista de datos", seniority: "junior" },
    question: "Contame una vez que resolviste un problema con datos.",
    answer: "Cuando el cierre tardaba dos días armé un tablero y lo bajé a una hora, un 80% menos.",
    expect: { clarity: [6, 10], relevance: [6, 10], star: [6, 10] },
  };

  it("acepta un caso válido", () => {
    const r = parseInterviewGolden([sample]);
    expect(r.ok).toBe(true);
  });

  it("rechaza rangos invertidos o fuera de 0 a 10", () => {
    expect(
      parseInterviewGolden([{ ...sample, expect: { ...sample.expect, star: [8, 4] } }]).ok,
    ).toBe(false);
    expect(
      parseInterviewGolden([{ ...sample, expect: { ...sample.expect, star: [0, 11] } }]).ok,
    ).toBe(false);
  });

  it("rechaza ids repetidos", () => {
    expect(parseInterviewGolden([sample, sample]).ok).toBe(false);
  });
});

// El archivo real vive en evals/ (no lo escribe el equipo de la tanda: lo copia quien tenga permiso). Si
// todavía no está, se valida la propuesta de la tanda (carpeta no versionada) y, si tampoco está, el chequeo
// se saltea.
const GOLDEN_CANDIDATES = [
  "../../../../evals/fixtures/interview/golden.json",
  "../../../../ops/rondas/r17-tanda/R17-08/propuesta/evals/fixtures/interview/golden.json",
].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const GOLDEN_PATH = GOLDEN_CANDIDATES.find((p) => existsSync(p)) ?? GOLDEN_CANDIDATES[0]!;

describe.skipIf(!existsSync(GOLDEN_PATH))("golden de interview", () => {
  it("tiene diez casos válidos y sin datos reales", () => {
    const raw = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as unknown;
    const r = parseInterviewGolden(raw);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(INTERVIEW_GOLDEN_SIZE);
    const text = JSON.stringify(raw);
    expect(text).not.toMatch(/@(?!example\.)[a-z0-9-]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/https?:\/\//i);
  });
});
