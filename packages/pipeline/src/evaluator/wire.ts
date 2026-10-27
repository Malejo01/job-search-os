import { z } from "zod";
import {
  EvaluationV11OutputSchema,
  EvaluationV12OutputSchema,
  EvaluationV14OutputSchema,
  EvaluationV1OutputSchema,
  GapSchema,
} from "../evaluation";

/**
 * Borde del LLM (C-26 F0). Algunos proveedores (Anthropic) no imponen `maxLength`, `maxItems`,
 * `minimum` ni `maximum` del JSON Schema: los dejan como texto en la descripción. El esquema que
 * viaja al modelo no lleva esos límites; lo que vuelve se normaliza con funciones puras y recién
 * después corre la validación estricta de siempre. Lo que llega a `decide()` y a la base cumple
 * el mismo contrato que antes.
 */
export type LlmWire = {
  /** Lo que viaja al proveedor: la misma forma que el esquema estricto, sin límites de largo ni de rango. */
  schema: z.ZodType<unknown>;
  /** Recorta lo que excede los límites. Lo que no se puede normalizar pasa tal cual y falla en la validación estricta. */
  normalize: (raw: unknown) => unknown;
};

export const VEREDICTO_MAX_CHARS = 200;
export const EVALUATION_LIST_MAX = 8;
export const SCORE_MAX = 10;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Recorta a `max` caracteres sin partir una palabra (salvo que no haya un solo espacio donde cortar). */
function clampText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  if (/\s/.test(text.charAt(max))) return head.trimEnd();
  const lastSpace = head.search(/\s\S*$/);
  return (lastSpace > 0 ? head.slice(0, lastSpace) : head).trimEnd();
}

/**
 * Normaliza la salida cruda del evaluador: `veredicto` a 200 caracteres, `match_fuerte` y `gaps`
 * a los primeros 8, `score` a 0..10 con un decimal. Solo toca campos con el tipo esperado; el resto
 * queda igual para que la validación estricta falle cerrado. No muta la entrada.
 */
export function normalizeEvaluationOutput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out: Record<string, unknown> = { ...raw };
  if (typeof out.score === "number" && Number.isFinite(out.score)) {
    out.score = Math.round(Math.min(SCORE_MAX, Math.max(0, out.score)) * 10) / 10;
  }
  if (typeof out.veredicto === "string") {
    out.veredicto = clampText(out.veredicto, VEREDICTO_MAX_CHARS);
  }
  for (const key of ["match_fuerte", "gaps"] as const) {
    const list = out[key];
    if (Array.isArray(list) && list.length > EVALUATION_LIST_MAX) {
      out[key] = list.slice(0, EVALUATION_LIST_MAX);
    }
  }
  return out;
}

const relaxed = {
  score: z.number(),
  match_fuerte: z.array(z.string()),
  veredicto: z.string(),
};

/** Esquema sin límites para cada versión de `evaluate_job` (misma tabla que `outputSchemaFor`). */
function wireSchemaFor(promptRef: string): z.ZodType<unknown> {
  const version = promptRef.split("@")[1] ?? "v1";
  switch (version) {
    case "v1":
      return EvaluationV1OutputSchema.extend({ ...relaxed, gaps: z.array(z.string()) });
    case "v1.1":
    case "v1.2":
    case "v1.3":
    case "v1.3.1":
      return EvaluationV11OutputSchema.extend({ ...relaxed, gaps: z.array(GapSchema) });
    case "v1.3.2":
    case "v1.3.3":
    case "v1.3.4":
      return EvaluationV12OutputSchema.extend({ ...relaxed, gaps: z.array(GapSchema) });
    case "v1.4.0":
      return EvaluationV14OutputSchema.extend({ ...relaxed, gaps: z.array(GapSchema) });
    default:
      throw new Error(`sin schema de salida para ${promptRef}`);
  }
}

/** Esquema de viaje + normalización de `evaluate_job@vN`. */
export function evaluationWireFor(promptRef: string): LlmWire {
  return { schema: wireSchemaFor(promptRef), normalize: normalizeEvaluationOutput };
}
