import type { Checklist, ChecklistItem } from "../evaluator/checklist";
import { estadoRequisitoVisible } from "../glosario";

/**
 * Resumen de requisitos (R30-09). Puro: todo lo que la pantalla dice sobre requisitos sale de las
 * filas de la tabla de `evaluator/checklist.ts`, nunca de bloqueadores, gaps o riesgos sueltos.
 * Devuelve niveles y códigos, no palabras: la web traduce con `textos-rediseno.ts`.
 */

/** Estado que se muestra (glosario del plan §3): Coincide · Sin confirmar · No coincide. */
export type RequirementState = "coincide" | "sinConfirmar" | "noCoincide";

/** Código de la fila: el `id` del checklist, con `skill:<slug>` y `req:<n>` reducidos a su familia. */
export type RequirementCode =
  | "pais"
  | "residencia"
  | "autorizacion"
  | "modalidad"
  | "disciplina"
  | "anos"
  | "ingles"
  | "salario"
  | "jornada"
  | "skill"
  | "req"
  | "otro";

export type RequirementRow = {
  /** `id` original de la fila del checklist. */
  id: string;
  code: RequirementCode;
  nivel: ChecklistItem["nivel"];
  state: RequirementState;
  /**
   * true si la tabla decía `no_cumple` pero el perfil no tiene el dato: se muestra «Sin confirmar»
   * (regla del plan §2.1).
   */
  demoted: boolean;
  /** true si es una condición excluyente que no coincide. */
  excluding: boolean;
  item: ChecklistItem;
};

export type RequirementsSummary = {
  counts: Record<RequirementState, number>;
  /** La primera condición excluyente (`must`, que bloquea) que no coincide, o null. */
  blocking: RequirementRow | null;
  /** Hasta 3 filas que más pesan. */
  weighing: RequirementRow[];
  /** Hasta 2 filas sin confirmar para la línea «Sin confirmar: …» de la tarjeta. */
  cardUnconfirmed: RequirementRow[];
  /** Todas las filas, con su estado ya resuelto, en el orden de la tabla. */
  rows: RequirementRow[];
};

export const WEIGHING_MAX = 3;
export const CARD_UNCONFIRMED_MAX = 2;

const KNOWN_CODES: ReadonlySet<string> = new Set([
  "pais",
  "residencia",
  "autorizacion",
  "modalidad",
  "disciplina",
  "anos",
  "ingles",
  "salario",
  "jornada",
]);

function codeOf(it: ChecklistItem): RequirementCode {
  if (it.kind === "skill" || it.id.startsWith("skill:")) return "skill";
  if (it.id.startsWith("req:")) return "req";
  return KNOWN_CODES.has(it.id) ? (it.id as RequirementCode) : "otro";
}

/** Orden en que mira un reclutador (igual que `descarte_rapido`); la residencia gana a «país». */
const BLOCKING_ORDER: readonly string[] = [
  "residencia",
  "pais",
  "autorizacion",
  "modalidad",
  "disciplina",
  "anos",
  "ingles",
  "salario",
  "jornada",
];
const orderIndex = (code: string): number => {
  const i = BLOCKING_ORDER.indexOf(code);
  return i === -1 ? BLOCKING_ORDER.length : i;
};

function toRow(it: ChecklistItem): RequirementRow {
  const code = codeOf(it);
  // Regla 2.1 (una sola implementación, en glosario.ts): «No coincide» solo con un dato explícito
  // del perfil que sea distinto
  const visible = estadoRequisitoVisible(it.status, it.tenes !== null);
  const state: RequirementState =
    visible === "coincide" ? "coincide" : visible === "no_coincide" ? "noCoincide" : "sinConfirmar";
  const demoted = it.status === "no_cumple" && state === "sinConfirmar";
  const excluding = state === "noCoincide" && it.nivel === "must" && it.bloquea && code !== "skill";
  return { id: it.id, code, nivel: it.nivel, state, demoted, excluding, item: it };
}

export function summarizeRequirements(
  checklist: Pick<Checklist, "items"> | null | undefined,
): RequirementsSummary {
  const rows = (checklist?.items ?? []).map(toRow);
  const counts: Record<RequirementState, number> = { coincide: 0, sinConfirmar: 0, noCoincide: 0 };
  for (const r of rows) counts[r.state]++;

  const blocking =
    rows.filter((r) => r.excluding).sort((a, b) => orderIndex(a.code) - orderIndex(b.code))[0] ??
    null;

  const must = rows.filter((r) => r.nivel === "must");
  const deseable = rows.filter((r) => r.nivel !== "must");
  const of = (list: RequirementRow[], s: RequirementState) => list.filter((r) => r.state === s);
  const ordered: RequirementRow[] = [
    ...(blocking ? [blocking] : []),
    ...of(must, "noCoincide").filter((r) => r !== blocking),
    ...of(must, "sinConfirmar"),
    ...of(must, "coincide"),
    ...of(deseable, "sinConfirmar"),
    ...of(deseable, "noCoincide"),
    ...of(deseable, "coincide"),
  ];

  const unconfirmed = of(rows, "sinConfirmar");
  const cardUnconfirmed = [
    ...unconfirmed.filter((r) => r.nivel === "must"),
    ...unconfirmed.filter((r) => r.nivel !== "must" && r.code !== "skill"),
    ...unconfirmed.filter((r) => r.nivel !== "must" && r.code === "skill"),
  ].slice(0, CARD_UNCONFIRMED_MAX);

  return {
    counts,
    blocking,
    weighing: ordered.slice(0, WEIGHING_MAX),
    cardUnconfirmed,
    rows,
  };
}
