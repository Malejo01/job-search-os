import type { Proposal, ProposalDestination } from "@job-search-os/pipeline";

/**
 * Puente entre la tarjeta del asistente y el formulario de destino (AG-3). «Cargar en el
 * formulario» deja la propuesta en `sessionStorage` (solo esta pestaña) y navega; el formulario la
 * toma UNA vez y la carga. Nada se guarda hasta que la persona toca Guardar.
 *
 * Qué queda en `sessionStorage` y cuánto: solo destino, campos cambiados (etiqueta y valor nuevo,
 * sin el anterior), los valores para el formulario ya filtrados, la versión de criterios y cuándo
 * llegó la propuesta. Se borra SIEMPRE que se lee (sirva o no), vence a los 10 minutos de llegar
 * al navegador y se borra al entrar a /login (cerrar sesión no deja una propuesta para la próxima
 * persona que use la pestaña). No se usa un identificador de la persona: no hace falta con eso.
 */

const KEY = "asistente:propuesta";
/** Evento para cuando la persona ya está en la pantalla de destino (no hay navegación). */
export const PROPOSAL_EVENT = "asistente:propuesta";
/** Una propuesta vieja no se carga sola. Se cuenta desde que llegó al navegador. */
export const PROPOSAL_MAX_AGE_MS = 10 * 60 * 1000;

/** Pantalla de cada destino: la arma el cliente, nunca sale de una URL del servidor. */
export const PROPOSAL_FORM_PATH: Record<ProposalDestination, string> = {
  profile: "/settings/perfil",
  skill_levels: "/settings/skills",
  criteria: "/settings/criteria",
  target_roles: "/settings#puesto",
};

const PROFILE_FIELDS = new Set([
  "country",
  "city",
  "acceptedModalities",
  "jobLanguage",
  "workAuthUs",
  "workAuthEu",
  "workAuthOther",
  "englishCefr",
  "yearsTotal",
  "summary",
]);
const CRITERIA_FIELDS = new Set([
  "title_blocklist",
  "title_allowlist",
  "other_discipline_keywords",
  "allowed_disciplines",
  "salary_floor_usd_monthly",
  "max_weekly_hours",
  "max_years_hard",
  "english_risk_from",
  "threshold_personalizado",
  "threshold_aplicar",
  "threshold_guardar",
]);
const SKILL_LEVEL_FIELD = /^level:[a-z][a-z0-9_]{0,39}$/;

/** Lista cerrada de campos que cada destino puede tocar. */
export function allowedField(destination: ProposalDestination, name: string): boolean {
  switch (destination) {
    case "profile":
      return PROFILE_FIELDS.has(name);
    case "criteria":
      return CRITERIA_FIELDS.has(name);
    case "target_roles":
      return name === "targetRoles";
    case "skill_levels":
      return SKILL_LEVEL_FIELD.test(name);
  }
}

export type StoredProposal = {
  destination: ProposalDestination;
  formValues: Record<string, string | string[]>;
  diffs: { field: string; label: string; after: string }[];
  criteriaVersion: number | null;
  receivedAt: number;
};

/**
 * Lo que se guarda: solo campos de la lista cerrada del destino Y que estén en `diffs`. Lo demás
 * que pudiera traer la propuesta no llega al formulario.
 */
export function storedFrom(p: Proposal, receivedAt: number): StoredProposal {
  const changed = new Set(p.diffs.map((d) => d.field));
  const formValues = Object.fromEntries(
    Object.entries(p.formValues).filter(
      ([name]) => changed.has(name) && allowedField(p.destination, name),
    ),
  );
  return {
    destination: p.destination,
    formValues,
    diffs: p.diffs
      .filter((d) => allowedField(p.destination, d.field))
      .map((d) => ({ field: d.field, label: d.label, after: d.after })),
    criteriaVersion: p.criteriaVersion ?? null,
    receivedAt,
  };
}

export function stashProposal(p: Proposal, receivedAt: number): boolean {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(storedFrom(p, receivedAt)));
    return true;
  } catch {
    return false;
  }
}

/** ¿Quedó una propuesta sin tomar? (el panel lo mira para avisar si la pantalla no la cargó). */
export function hasPendingProposal(): boolean {
  try {
    return sessionStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

export function clearProposal(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // sin storage no hay nada que borrar
  }
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

function parseStored(raw: string | null, now: number): StoredProposal | null {
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
  const destination = o.destination as ProposalDestination;
  if (typeof o.receivedAt !== "number" || now - o.receivedAt > PROPOSAL_MAX_AGE_MS) return null;
  if (o.receivedAt > now + 60_000) return null;
  const values = o.formValues;
  if (typeof values !== "object" || values === null || Array.isArray(values)) return null;
  const diffs = Array.isArray(o.diffs)
    ? o.diffs.filter(
        (d): d is StoredProposal["diffs"][number] =>
          typeof d === "object" &&
          d !== null &&
          ["field", "label", "after"].every(
            (k) => typeof (d as Record<string, unknown>)[k] === "string",
          ) &&
          allowedField(destination, (d as { field: string }).field),
      )
    : [];
  const changed = new Set(diffs.map((d) => d.field));
  const formValues: Record<string, string | string[]> = {};
  for (const [k, val] of Object.entries(values)) {
    if (!changed.has(k) || !allowedField(destination, k)) continue;
    if (typeof val === "string" || isStringList(val)) formValues[k] = val;
    else return null;
  }
  const version = o.criteriaVersion;
  return {
    destination,
    formValues,
    diffs,
    criteriaVersion: typeof version === "number" && Number.isInteger(version) ? version : null,
    receivedAt: o.receivedAt,
  };
}

/**
 * Toma la propuesta guardada para este destino. La clave se borra SIEMPRE al leer: válida,
 * vencida, rota o de otro destino.
 */
export function takeProposal(destination: ProposalDestination): StoredProposal | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  clearProposal();
  const stored = parseStored(raw, Date.now());
  return stored && stored.destination === destination ? stored : null;
}
