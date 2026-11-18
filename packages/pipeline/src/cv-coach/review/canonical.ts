/**
 * JSON canónico de la lista de problemas firmada (ADR-038 §8). Puro: el HMAC lo calcula el adaptador
 * (`adapters/src/cv-coach/review/sign.ts`) sobre este texto. Claves ordenadas en todos los niveles, sin
 * espacios: el mismo contenido da siempre el mismo texto, sin importar el orden de las claves con que lo
 * reconstruyó el navegador.
 */
import type { CvIssue } from "../schemas";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    // números no finitos no tienen forma JSON: fallan cerrado como `null`, que el esquema no acepta
    if (typeof value === "number" && !Number.isFinite(value)) return "null";
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Lo que firma el HMAC (sin `mac`). El `userId` lo agrega el adaptador. */
export function cvCoachIssuesPayload(list: {
  v: 1;
  flowId: string;
  expiresAt: number;
  target: string;
  issues: readonly CvIssue[];
}): string {
  return canonicalJson({
    v: list.v,
    flowId: list.flowId,
    expiresAt: list.expiresAt,
    target: list.target,
    issues: list.issues,
  });
}
