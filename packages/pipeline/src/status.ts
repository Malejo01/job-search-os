/**
 * Máquina de estados de jobs.status (docs/SCHEMA.md). Las transiciones válidas viven acá,
 * no en la UI: los Server Actions y el worker llaman a transition() y nunca escriben
 * jobs.status directo.
 *
 * nueva → prefiltrada → pendiente_jd → evaluada → aplicada → {rechazada | entrevista → oferta}
 *   │         │                          │
 *   └─► descartada_prefiltro             └─► descartada
 * aplicada → rechazo_automatico · cualquiera → cerrada
 */
export const JOB_STATUSES = [
  "nueva",
  "prefiltrada",
  "descartada_prefiltro",
  "pendiente_jd",
  "evaluada",
  "aplicada",
  "descartada",
  "rechazo_automatico",
  "rechazada",
  "entrevista",
  "oferta",
  "cerrada",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_EVENTS = [
  "prefilter_pass",
  "prefilter_discard",
  "needs_jd",
  "evaluated",
  "apply",
  "discard",
  "auto_reject",
  "reject",
  "interview",
  "offer",
  "close",
] as const;
export type JobEvent = (typeof JOB_EVENTS)[number];

const TRANSITIONS: Record<JobStatus, Partial<Record<JobEvent, JobStatus>>> = {
  nueva: { prefilter_pass: "prefiltrada", prefilter_discard: "descartada_prefiltro" },
  prefiltrada: { needs_jd: "pendiente_jd", evaluated: "evaluada" },
  pendiente_jd: { evaluated: "evaluada" },
  evaluada: { apply: "aplicada", discard: "descartada", evaluated: "evaluada" },
  // `evaluated` desde aplicada, entrevista y oferta no mueve el estado (JS-057): re-evaluar es leer
  // de nuevo con otro prompt o perfil, no retroceder en el embudo. No agrega botones: la UI solo
  // ofrece MANUAL_EVENTS y `evaluated` lo dispara únicamente el worker.
  aplicada: {
    auto_reject: "rechazo_automatico",
    reject: "rechazada",
    interview: "entrevista",
    evaluated: "aplicada",
  },
  entrevista: { offer: "oferta", reject: "rechazada", evaluated: "entrevista" },
  descartada_prefiltro: {},
  descartada: {},
  rechazo_automatico: {},
  rechazada: {},
  oferta: { evaluated: "oferta" },
  cerrada: {},
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: JobStatus,
    public readonly event: JobEvent,
  ) {
    super(`transición inválida: ${from} + ${event}`);
    this.name = "InvalidTransitionError";
  }
}

/** Próximo estado o lanza InvalidTransitionError. `close` vale desde cualquier estado. */
export function transition(status: JobStatus, event: JobEvent): JobStatus {
  if (event === "close") return "cerrada";
  const next = TRANSITIONS[status]?.[event];
  if (!next) throw new InvalidTransitionError(status, event);
  return next;
}

export function canTransition(status: JobStatus, event: JobEvent): boolean {
  return event === "close" || TRANSITIONS[status]?.[event] !== undefined;
}

/** Eventos válidos desde un estado (para la UI: qué botones mostrar). */
export function availableEvents(status: JobStatus): JobEvent[] {
  const own = Object.keys(TRANSITIONS[status] ?? {}) as JobEvent[];
  return status === "cerrada" ? own : [...own, "close"];
}

/**
 * Qué se puede re-encolar para evaluar de nuevo (JS-057). El requeue masivo (`--model`) toca solo
 * `evaluada`, para no re-evaluar el embudo entero sin querer; con `--job` explícito también lo
 * que ya tiene una postulación en curso, cuyas evaluaciones alimentan market_summary. Lo terminal
 * (descartada, rechazada, cerrada) y lo que nunca se evaluó no entra en ningún caso.
 */
export const REQUEUE_STATUSES = {
  bulk: ["evaluada"],
  explicit: ["evaluada", "aplicada", "entrevista", "oferta"],
} as const satisfies Record<string, readonly JobStatus[]>;

export function requeueAllowed(status: JobStatus, mode: "bulk" | "explicit"): boolean {
  return (REQUEUE_STATUSES[mode] as readonly JobStatus[]).includes(status);
}
