import { z } from "zod";
import { MAX_JOB_FIELD_CHARS } from "../manual-paste";
import { parseManualUrl } from "../manual-url";
import { err, ok, type Result } from "../result";
import {
  canTransition,
  MANUAL_JOB_EVENTS,
  transition,
  type JobEvent,
  type JobStatus,
  type ManualJobEvent,
} from "../status";
import { CV_OMITTED_MARKER, looksLikeCv } from "./cv-detect";
import type { AgentMessage } from "./history";
import { isGrounded, normalizeForQuote, type GroundingSources } from "./proposal";
import { groundingSchema, type AgentActionTool } from "./tools";
import type { DroppedReason, Grounding } from "./types";

/**
 * Propuestas de acción del asistente (AG-5). Como las de formulario, NO escriben: devuelven una
 * tarjeta-formulario que la persona confirma con un clic, y ese clic llama a la Server Action de
 * siempre (`changeStatusAction` del detalle o `createManualJobAction` del alta manual). ADR-004:
 * «aplicada» solo marca el estado; el sistema nunca postula por la persona.
 */

export const JOB_MODALITIES = ["remoto", "hibrido", "presencial", "desconocida"] as const;
export type JobModality = (typeof JOB_MODALITIES)[number];

export const proposeStatusChangeInput = z
  .object({
    job_id: z.string().uuid(),
    event: z.enum(MANUAL_JOB_EVENTS),
    source: groundingSchema,
  })
  .strict();

export const proposeNewJobInput = z
  .object({
    title: z.string().min(3).max(MAX_JOB_FIELD_CHARS),
    company: z.string().min(1).max(MAX_JOB_FIELD_CHARS),
    url: z.string().max(2000).optional(),
    location: z.string().max(MAX_JOB_FIELD_CHARS).optional(),
    modality: z.enum(JOB_MODALITIES).optional(),
    source: groundingSchema,
  })
  .strict();

export const actionInputSchemas = {
  propose_status_change: proposeStatusChangeInput,
  propose_new_job: proposeNewJobInput,
} as const satisfies Record<AgentActionTool, z.ZodType>;

type Dropped = { field: string; reason: DroppedReason };

export type StatusChangeAction = {
  kind: "status_change";
  jobId: string;
  /** «Título · Empresa», leído de la base con el usuario de la sesión (no lo que dijo el modelo). */
  jobLabel: string;
  event: ManualJobEvent;
  fromStatus: JobStatus;
  fromLabel: string;
  toLabel: string;
  source: Grounding;
};

export type NewJobAction = {
  kind: "new_job";
  fields: {
    title: string;
    company: string;
    url: string | null;
    location: string | null;
    modality: JobModality;
  };
  source: Grounding;
  /** Campos que el modelo mandó y no se prellenan, con el motivo (sin el valor). */
  dropped: Dropped[];
};

export type ActionProposal = StatusChangeAction | NewJobAction;

export type ActionError =
  "entrada_invalida" | "sin_contexto" | "oferta_inexistente" | "sin_fundamento" | "invalido";

export type ActionFailure = { code: ActionError; dropped: Dropped[] };

/** La oferta tal como la ve la persona (RLS), con los eventos manuales válidos desde su estado. */
export type ActionJob = {
  id: string;
  title: string;
  company: string;
  status: JobStatus;
  events: readonly JobEvent[];
};

export type StatusChangeContext = {
  job: ActionJob | null;
  /** Fuentes de fundamento de la persona (`groundingSourcesFrom`). */
  sources: GroundingSources;
  statusLabels?: Readonly<Record<string, string>>;
};

/**
 * Textos de la persona para prellenar un aviso: todos sus mensajes salvo los CVs. A diferencia del
 * fundamento del perfil, acá un aviso pegado sí cuenta: los datos son del aviso, no de la persona.
 */
export type NewJobContext = { userTexts: readonly string[] };

export function actionSourcesFrom(messages: readonly AgentMessage[]): NewJobContext {
  return {
    userTexts: messages
      .filter((m) => m.role === "user")
      .map((m) => m.text)
      .filter((text) => text !== CV_OMITTED_MARKER && !looksLikeCv(text)),
  };
}

/**
 * Palabras que nombran cada evento, ya plegadas (sin acentos, minúsculas). Se buscan al comienzo de
 * una palabra, así «postul» vale para «postulé» y «postulación». «oferta» sola no alcanza para
 * `offer`: «esta oferta» aparece en cualquier pedido sobre una oferta.
 */
const EVENT_WORDS: Record<ManualJobEvent, readonly string[]> = {
  apply: [
    "postul",
    "aplique",
    "aplicado",
    "me anote",
    "mande el cv",
    "mande mi cv",
    "envie el cv",
    "envie mi cv",
  ],
  interview: ["entrevista"],
  offer: [
    "me ofrecieron",
    "me hicieron una oferta",
    "me hicieron una propuesta",
    "recibi una oferta",
    "recibi la oferta",
    "me llego una oferta",
    "me llego la oferta",
    "me llego una propuesta",
  ],
  reject: ["rechaz", "no quede", "no avance", "no avanzo", "no sigo en el proceso", "me bocharon"],
  auto_reject: ["rechaz", "automatic", "ni me leyeron"],
  discard: ["descart", "no me interesa", "no me sirve"],
  close: ["cerr", "ya no esta", "la bajaron", "dieron de baja"],
};

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ¿La cita (ya normalizada) nombra el evento? */
export function eventInQuote(event: ManualJobEvent, quote: string): boolean {
  const text = normalizeForQuote(quote);
  return EVENT_WORDS[event].some((w) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}`, "u").test(text),
  );
}

const FORMAT_CHARS = /\p{Cf}/u;

function hasControl(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return FORMAT_CHARS.test(text);
}

const fail = (code: ActionError, dropped: Dropped[] = []) => err<ActionFailure>({ code, dropped });

export function buildStatusChangeAction(
  input: unknown,
  ctx: StatusChangeContext,
): Result<ActionProposal, ActionFailure> {
  const parsed = proposeStatusChangeInput.safeParse(input);
  if (!parsed.success) return fail("entrada_invalida");
  const { job_id: jobId, event, source } = parsed.data;
  // Siempre la oferta que leyó la app con el usuario de la sesión; un id ajeno no existe
  if (!ctx.job || ctx.job.id !== jobId) return fail("oferta_inexistente");
  // `events` lo arma la app; igual se verifica con la máquina de estados (el pipeline no lanza)
  if (!ctx.job.events.includes(event) || !canTransition(ctx.job.status, event)) {
    return fail("invalido", [{ field: "event", reason: "invalido" }]);
  }
  if (
    source.from !== "message" ||
    !isGrounded(source, ctx.sources) ||
    !eventInQuote(event, source.quote)
  ) {
    return fail("sin_fundamento", [{ field: "event", reason: "sin_fundamento" }]);
  }
  const label = (status: string) => ctx.statusLabels?.[status] ?? status;
  const to = transition(ctx.job.status, event);
  return ok({
    kind: "status_change",
    jobId,
    jobLabel: `${ctx.job.title} · ${ctx.job.company}`,
    event,
    fromStatus: ctx.job.status,
    fromLabel: label(ctx.job.status),
    toLabel: label(to),
    source,
  });
}

/** Palabras de cada modalidad (plegadas) que la persona tiene que haber escrito. */
const MODALITY_WORDS: Record<Exclude<JobModality, "desconocida">, readonly string[]> = {
  remoto: ["remot"],
  hibrido: ["hibrid", "hybrid"],
  presencial: ["presencial", "on-site", "onsite", "en oficina"],
};

export function buildNewJobAction(
  input: unknown,
  ctx: NewJobContext,
): Result<ActionProposal, ActionFailure> {
  const parsed = proposeNewJobInput.safeParse(input);
  if (!parsed.success) return fail("entrada_invalida");
  const v = parsed.data;
  const texts = ctx.userTexts.map(normalizeForQuote);
  const literal = (value: string): boolean => {
    const needle = normalizeForQuote(value);
    return needle !== "" && texts.some((t) => t.includes(needle));
  };

  const dropped: Dropped[] = [];
  for (const field of ["title", "company"] as const) {
    const value = v[field].trim();
    if (hasControl(value)) return fail("invalido", [{ field, reason: "invalido" }]);
    if (!literal(value)) return fail("sin_fundamento", [{ field, reason: "sin_fundamento" }]);
  }
  if (
    v.source.from !== "message" ||
    !isGrounded(v.source, { userMessages: ctx.userTexts, profileTexts: [] })
  ) {
    return fail("sin_fundamento", [{ field: "source", reason: "sin_fundamento" }]);
  }

  let url: string | null = null;
  if (v.url !== undefined && v.url.trim() !== "") {
    const raw = v.url.trim();
    const checked = parseManualUrl(raw);
    if (hasControl(raw) || !checked.ok || checked.url === null) {
      dropped.push({ field: "url", reason: "invalido" });
    } else if (!literal(raw)) {
      dropped.push({ field: "url", reason: "sin_fundamento" });
    } else {
      url = checked.url;
    }
  }

  let location: string | null = null;
  if (v.location !== undefined && v.location.trim() !== "") {
    const raw = v.location.trim();
    if (hasControl(raw)) dropped.push({ field: "location", reason: "invalido" });
    else if (!literal(raw)) dropped.push({ field: "location", reason: "sin_fundamento" });
    else location = raw;
  }

  let modality: JobModality = "desconocida";
  if (v.modality && v.modality !== "desconocida") {
    const words = MODALITY_WORDS[v.modality];
    const said = texts.some((t) =>
      words.some((w) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(w)}`, "u").test(t)),
    );
    if (said) modality = v.modality;
    else dropped.push({ field: "modality", reason: "sin_fundamento" });
  }

  return ok({
    kind: "new_job",
    fields: { title: v.title.trim(), company: v.company.trim(), url, location, modality },
    source: v.source,
    dropped,
  });
}

export type ActionContext = { statusChange?: StatusChangeContext; newJob?: NewJobContext };

export function buildActionProposal(
  tool: AgentActionTool,
  input: unknown,
  ctx: ActionContext,
): Result<ActionProposal, ActionFailure> {
  switch (tool) {
    case "propose_status_change":
      return ctx.statusChange
        ? buildStatusChangeAction(input, ctx.statusChange)
        : fail("sin_contexto");
    case "propose_new_job":
      return ctx.newJob ? buildNewJobAction(input, ctx.newJob) : fail("sin_contexto");
  }
}

/** Lo único de una acción que va a un log: tipo, evento (un enum) y campos. Nunca títulos ni citas. */
export function actionLogMeta(a: ActionProposal | ActionFailure): {
  kind?: ActionProposal["kind"];
  event?: ManualJobEvent;
  fields: string[];
  dropped: Dropped[];
} {
  if ("kind" in a) {
    if (a.kind === "status_change")
      return { kind: a.kind, event: a.event, fields: ["event"], dropped: [] };
    const fields = (Object.keys(a.fields) as (keyof NewJobAction["fields"])[]).filter(
      (k) => a.fields[k] !== null && a.fields[k] !== "desconocida",
    );
    return { kind: a.kind, fields, dropped: [...a.dropped] };
  }
  return { fields: [], dropped: [...a.dropped] };
}

/** Resultado de una tool de acción: la tarjeta para la app y un resumen sin valores para el modelo. */
export type ActionOutput =
  { ok: true; action: ActionProposal } | { ok: false; code: ActionError; dropped: Dropped[] };

export function isActionOutput(v: unknown): v is ActionOutput {
  return typeof v === "object" && v !== null && "ok" in v && typeof v.ok === "boolean";
}

export function actionModelText(out: unknown): string {
  if (!isActionOutput(out)) return JSON.stringify({ error: "tool_fallo" });
  if (out.ok) {
    const meta = actionLogMeta(out.action);
    return JSON.stringify({
      tarjeta_lista: true,
      tipo: out.action.kind,
      ...(meta.event ? { evento: meta.event } : {}),
      campos: meta.fields,
      descartados: meta.dropped,
      nota: "La persona la revisa en una tarjeta y decide si la confirma. Todavía no se hizo nada.",
    });
  }
  return JSON.stringify({ tarjeta_lista: false, motivo: out.code, descartados: out.dropped });
}
