import type { Proposal, ProposalDestination } from "@job-search-os/pipeline";

/**
 * Puente entre la tarjeta del asistente y el formulario de destino (AG-3). «Cargar en el
 * formulario» deja la propuesta en `sessionStorage` (solo esta pestaña) y navega; el formulario la
 * toma UNA vez, la borra y carga los valores. Nada se guarda hasta que la persona toca Guardar.
 */

const KEY = "asistente:propuesta";
/** Evento para cuando la persona ya está en la pantalla de destino (no hay navegación). */
export const PROPOSAL_EVENT = "asistente:propuesta";
/** Una propuesta vieja no se carga sola días después. */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Pantalla de cada destino: la arma el cliente, nunca sale de una URL del servidor. */
export const PROPOSAL_FORM_PATH: Record<ProposalDestination, string> = {
  profile: "/settings/perfil",
  skill_levels: "/settings/skills",
  criteria: "/settings/criteria",
  target_roles: "/settings#puesto",
};

export type StoredProposal = {
  destination: ProposalDestination;
  formValues: Record<string, string | string[]>;
  diffs: { field: string; label: string; before: string; after: string }[];
  savedAt: number;
};

export function stashProposal(p: Proposal): boolean {
  const stored: StoredProposal = {
    destination: p.destination,
    formValues: p.formValues,
    diffs: p.diffs.map((d) => ({
      field: d.field,
      label: d.label,
      before: d.before,
      after: d.after,
    })),
    savedAt: Date.now(),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function parseStored(raw: string | null): StoredProposal | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.destination !== "string" || !(o.destination in PROPOSAL_FORM_PATH)) return null;
  if (typeof o.savedAt !== "number" || Date.now() - o.savedAt > MAX_AGE_MS) return null;
  const values = o.formValues;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const formValues: Record<string, string | string[]> = {};
  for (const [k, val] of Object.entries(values)) {
    if (typeof val === "string" || isStringList(val)) formValues[k] = val;
    else return null;
  }
  const diffs = Array.isArray(o.diffs)
    ? o.diffs.filter(
        (d): d is StoredProposal["diffs"][number] =>
          typeof d === "object" &&
          d !== null &&
          ["field", "label", "before", "after"].every(
            (k) => typeof (d as Record<string, unknown>)[k] === "string",
          ),
      )
    : [];
  return {
    destination: o.destination as ProposalDestination,
    formValues,
    diffs,
    savedAt: o.savedAt,
  };
}

/** Toma la propuesta guardada para este destino y la borra. Cualquier otra cosa → null. */
export function takeProposal(destination: ProposalDestination): StoredProposal | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  const stored = parseStored(raw);
  if (!stored || stored.destination !== destination) return null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // sin storage no hay nada que borrar
  }
  return stored;
}
