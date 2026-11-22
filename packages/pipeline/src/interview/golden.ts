import { z } from "zod";
import { err, ok, type Result } from "../result";
import { INTERVIEW_ANSWER_MAX_CHARS } from "./input";
import { INTERVIEW_SENIORITIES } from "./prompt";
import type { InterviewFeedbackOutput } from "./schemas";

/**
 * Golden chico del simulador (`interview_feedback`): casos inventados con el rango de puntaje que se espera
 * de cada criterio y controles puntuales (no repetir un dato, marcar con corchetes lo que falta, no dejarse
 * forzar un 10). Lógica pura: el harness de `evals/` carga el archivo, llama al modelo y usa esto para
 * puntuar. Se informa siempre una métrica **estricta** (todo en rango) y una **laxa** (cada puntaje a 1 punto
 * del rango): una sola no alcanza para decidir.
 */
export const INTERVIEW_GOLDEN_SIZE = 10;
export const INTERVIEW_LAX_TOLERANCE = 1;

const Range = z
  .tuple([z.number().int().min(0).max(10), z.number().int().min(0).max(10)])
  .refine(([min, max]) => min <= max, "el rango tiene el mínimo mayor que el máximo");

const ExpectSchema = z.object({
  clarity: Range,
  relevance: Range,
  star: Range,
  /** Textos que el consejo y el ejemplo no pueden repetir (por ejemplo, un dato sensible de la respuesta). */
  forbidden: z.array(z.string().min(1)).optional(),
  /** El ejemplo tiene que marcar con [corchetes] lo que la persona debe completar. */
  examplePlaceholders: z.boolean().optional(),
  /** La respuesta intenta forzar un 10: no puede darlo en los tres criterios. */
  notAllTens: z.boolean().optional(),
});
export type InterviewGoldenExpect = z.infer<typeof ExpectSchema>;

const ContextSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("career"),
    career: z.string().min(1).max(120),
    seniority: z.enum(INTERVIEW_SENIORITIES),
  }),
  z.object({
    kind: z.literal("job"),
    title: z.string().min(1).max(160),
    company: z.string().max(160),
    description: z.string().nullable(),
  }),
]);

export const InterviewGoldenCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  context: ContextSchema,
  question: z.string().min(10).max(280),
  answer: z.string().min(1).max(INTERVIEW_ANSWER_MAX_CHARS),
  expect: ExpectSchema,
  notes: z.string().optional(),
});
export type InterviewGoldenCase = z.infer<typeof InterviewGoldenCaseSchema>;

export function parseInterviewGolden(raw: unknown): Result<InterviewGoldenCase[], string> {
  const parsed = z.array(InterviewGoldenCaseSchema).safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return err(`golden inválido en ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "?"}`);
  }
  const ids = new Set<string>();
  for (const c of parsed.data) {
    if (ids.has(c.id)) return err(`golden inválido: id repetido ${c.id}`);
    ids.add(c.id);
  }
  return ok(parsed.data);
}

export type InterviewCaseCheck = { strict: boolean; lax: boolean; failures: string[] };

const CRITERIA = ["clarity", "relevance", "star"] as const;

/** Puntúa una salida del modelo contra lo esperado. Los controles de texto cuentan igual en estricto y laxo. */
export function checkInterviewFeedback(
  expected: InterviewGoldenExpect,
  output: InterviewFeedbackOutput,
): InterviewCaseCheck {
  const failures: string[] = [];
  let strict = true;
  let lax = true;
  for (const key of CRITERIA) {
    const [min, max] = expected[key];
    const value = output[key];
    if (value < min || value > max) {
      strict = false;
      failures.push(`${key} ${value} fuera de ${min}-${max}`);
      if (value < min - INTERVIEW_LAX_TOLERANCE || value > max + INTERVIEW_LAX_TOLERANCE)
        lax = false;
    }
  }
  const text = `${output.tip}\n${output.example}`.toLowerCase();
  for (const word of expected.forbidden ?? []) {
    if (text.includes(word.toLowerCase())) {
      strict = false;
      lax = false;
      failures.push(`repite un dato que no debía: "${word}"`);
    }
  }
  if (expected.examplePlaceholders && !/\[[^\]]+\]/.test(output.example)) {
    strict = false;
    lax = false;
    failures.push("el ejemplo no marca con [corchetes] lo que falta");
  }
  if (expected.notAllTens && CRITERIA.every((key) => output[key] === 10)) {
    strict = false;
    lax = false;
    failures.push("puso 10 en todo");
  }
  return { strict, lax, failures };
}

export type InterviewChecksSummary = {
  n: number;
  strict: number;
  lax: number;
  strictRate: number | null;
  laxRate: number | null;
};

export function summarizeInterviewChecks(
  checks: readonly InterviewCaseCheck[],
): InterviewChecksSummary {
  const n = checks.length;
  const strict = checks.filter((c) => c.strict).length;
  const lax = checks.filter((c) => c.lax).length;
  return {
    n,
    strict,
    lax,
    strictRate: n === 0 ? null : strict / n,
    laxRate: n === 0 ? null : lax / n,
  };
}
