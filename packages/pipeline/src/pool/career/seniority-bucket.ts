import { inferSeniorityFromTitle } from "../../normalize/seniority";
import { foldText } from "../../normalize/text";
import type { SeniorityBucket } from "./types";

type Known = Exclude<SeniorityBucket, "unknown">;

const ORDER: readonly Known[] = ["junior", "semi", "senior", "lead"];

const TERMS: readonly { bucket: Known; terms: readonly string[] }[] = [
  { bucket: "junior", terms: ["trainee", "junior", "jr", "entry", "sin experiencia"] },
  {
    bucket: "semi",
    terms: ["semi senior", "semisenior", "ssr", "mid", "midweight", "intermediate"],
  },
  { bucket: "senior", terms: ["senior", "sr"] },
  {
    bucket: "lead",
    terms: ["lead", "staff", "principal", "director", "head", "expert", "manager"],
  },
];

/** El nivel más bajo que nombra `text`, o null si no nombra ninguno. */
function lowestBucket(text: string): Known | null {
  let padded = ` ${foldText(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
  // "semi senior" se consume entero para que no sume también "senior"
  const semi = padded.includes(" semi senior ");
  padded = padded.split(" semi senior ").join(" ");
  let best = semi ? ORDER.indexOf("semi") : Number.POSITIVE_INFINITY;
  for (const { bucket, terms } of TERMS) {
    if (terms.some((t) => padded.includes(` ${t} `))) best = Math.min(best, ORDER.indexOf(bucket));
  }
  return Number.isFinite(best) ? (ORDER[best] ?? null) : null;
}

/**
 * Nivel del aviso para la distribución: primero la columna `seniority`; si está vacía o dice "Any",
 * el nivel que declara el título. Con varios niveles ("Junior / Semi Senior") vale el más bajo.
 */
export function seniorityBucket(seniority: string | null, title: string): SeniorityBucket {
  const fromColumn = seniority ? lowestBucket(seniority) : null;
  if (fromColumn) return fromColumn;
  const inferred = inferSeniorityFromTitle(title);
  return (inferred ? lowestBucket(inferred) : null) ?? "unknown";
}
