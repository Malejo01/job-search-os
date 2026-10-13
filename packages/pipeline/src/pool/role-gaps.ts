import type { RoleKey } from "../skills/self-assessment";

/**
 * Explicación del vacío por puesto (ronda 46): para un puesto elegido sin ofertas, resume por qué
 * los avisos del pool no llegaron (descartes del prefiltro agrupados por motivo) y arma el mensaje.
 * Puro y determinista: no lee la base ni llama a ningún modelo.
 */
export type RoleGapInput = {
  role: RoleKey;
  label: string;
  /** Avisos del pool de ese puesto en la ventana de la asignación (sin las que la persona ya tiene). */
  poolCount: number;
  /** Descartes del prefiltro: `reason` y `detail` tal cual los devuelve `prefilter`. */
  discards: { reason: string; detail: string }[];
  /** Avisos que pasan el prefiltro y todavía no están asignadas. */
  pendingCount: number;
};

export type RoleGapCause =
  "blocklist" | "modalidad" | "disciplina" | "otros" | "sin_avisos" | "pendientes";

export type RoleGapGroup = { key: string; text: string; count: number };

export type RoleGapSummary = {
  role: RoleKey;
  label: string;
  total: number;
  groups: RoleGapGroup[];
  pending: number;
  mainCause: RoleGapCause;
};

/** Máximo de motivos que nombra el mensaje; el resto se suma en "otros motivos". */
const MAX_REASONS = 3;
const CRITERIA_NOTE = " (lo excluís en tus criterios)";

const upperFirst = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/** `'senior' en el título` → `senior`; null si el detalle no trae la palabra entre comillas. */
function blocklistWord(detail: string): string | null {
  const m = /^'(.+?)' en el título/.exec(detail);
  return m?.[1]?.trim() ? m[1].trim() : null;
}

function classify(d: { reason: string; detail: string }): { key: string; text: string } {
  if (d.reason === "titulo_blocklist") {
    const word = blocklistWord(d.detail);
    if (word) return { key: `blocklist:${word.toLowerCase()}`, text: `piden ${upperFirst(word)}` };
  } else if (d.reason === "modalidad_no_remota") {
    return { key: "modalidad", text: "no son remotas" };
  } else if (d.reason === "disciplina_distinta") {
    return { key: "disciplina", text: "son de otro oficio" };
  }
  return { key: "otros", text: "no pasan tus filtros" };
}

const causeOf = (key: string): RoleGapCause =>
  key.startsWith("blocklist")
    ? "blocklist"
    : key === "modalidad"
      ? "modalidad"
      : key === "disciplina"
        ? "disciplina"
        : "otros";

export function summarizeRoleGap(input: RoleGapInput): RoleGapSummary {
  const byKey = new Map<string, RoleGapGroup>();
  for (const d of input.discards) {
    const { key, text } = classify(d);
    const g = byKey.get(key);
    if (g) g.count++;
    else byKey.set(key, { key, text, count: 1 });
  }
  // Orden estable: por cantidad y, a igual cantidad, el orden de aparición
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count);
  const discarded = input.discards.length;
  const mainCause: RoleGapCause =
    input.poolCount <= 0
      ? "sin_avisos"
      : input.pendingCount > discarded || groups.length === 0
        ? input.pendingCount > 0
          ? "pendientes"
          : "otros"
        : causeOf(groups[0]!.key);
  return {
    role: input.role,
    label: input.label,
    total: input.poolCount,
    groups,
    pending: input.pendingCount,
    mainCause,
  };
}

/** Texto del motivo en singular, a partir del plural del grupo. */
function singular(g: RoleGapGroup): string {
  if (g.key.startsWith("blocklist")) return g.text.replace(/^piden /, "pide ");
  if (g.key === "modalidad") return "no es remota";
  if (g.key === "disciplina") return "es de otro oficio";
  return "no pasa tus filtros";
}

const reasonText = (g: RoleGapGroup, count: number) => (count === 1 ? singular(g) : g.text);

export function roleGapMessage(summary: RoleGapSummary): string {
  const { label, total, groups, pending } = summary;
  if (total <= 0) {
    return `Todavía no hay ofertas de ${label} en las fuentes que miramos (últimas 2 semanas).`;
  }
  const intro = `Hay ${total} ${total === 1 ? "oferta" : "ofertas"} de ${label}:`;
  const pendingText = (all: boolean) =>
    pending === 1
      ? `${all ? "" : "1 "}pasa tus filtros y se va sumando con tu tope diario.`
      : `${all ? "todas " : `${pending} `}pasan tus filtros y se van sumando con tu tope diario.`;

  if (groups.length === 0) return `${intro} ${pendingText(pending === total)}`;

  let noteUsed = false;
  const note = (g: RoleGapGroup) => {
    if (noteUsed || !g.key.startsWith("blocklist")) return "";
    noteUsed = true;
    return CRITERIA_NOTE;
  };

  let discards: string;
  const discarded = groups.reduce((n, g) => n + g.count, 0);
  if (groups.length === 1 && discarded === total) {
    const g = groups[0]!;
    discards = `${intro} ${total === 1 ? "" : "todas "}${reasonText(g, total)}${note(g)}.`;
  } else {
    const shown = groups
      .slice(0, MAX_REASONS)
      .map((g) => `${g.count} ${reasonText(g, g.count)}${note(g)}`);
    const rest = groups.slice(MAX_REASONS).reduce((n, g) => n + g.count, 0);
    discards = `${intro} ${shown.join(", ")}${rest > 0 ? ` y ${rest} por otros motivos` : ""}.`;
  }
  return pending > 0 ? `${discards} ${pendingText(false)}` : discards;
}
