import { z } from "zod";
import { MAX_JOB_FIELD_CHARS } from "../manual-paste";
import { parseManualUrl } from "../manual-url";
import { foldText } from "../normalize/text";
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
import { hasWord, isGrounded } from "./proposal";
import { hasUnsafeChars } from "./text-safety";
import { groundingSchema, type AgentActionTool } from "./tools";
import type { DroppedReason, Grounding } from "./types";

/**
 * Propuestas de acción del asistente (AG-5). Como las de formulario, NO escriben: devuelven una
 * tarjeta-formulario que la persona confirma con un clic, y ese clic llama a una Server Action que
 * comparte el núcleo con la de siempre (cambiar el estado desde el detalle, el alta manual).
 * ADR-004: «aplicada» solo marca el estado; el sistema nunca postula por la persona.
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
    title: z.string().trim().min(3).max(MAX_JOB_FIELD_CHARS),
    company: z.string().trim().min(2).max(MAX_JOB_FIELD_CHARS),
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
  /** La oración completa del mensaje de la persona que contiene la cita (la tarjeta muestra esto). */
  sentence: string;
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
  /**
   * El mensaje de la persona de ESTE turno. Un cambio de estado solo se fundamenta en lo que la
   * persona acaba de decir, no en algo de hace tres turnos.
   */
  lastUserMessage: string;
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

// --- Fundamento de un cambio de estado ---------------------------------------------------------

/** Palabras sin acentos, en minúscula. `keepSi` conserva «sí» (afirmación) distinto de «si». */
function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw === "") continue;
    out.push(raw === "sí" ? "sí" : foldText(raw));
  }
  return out;
}

/** Una frase clave: cada posición admite una o varias palabras (ya plegadas). */
type Phrase = readonly (readonly string[])[];
const p = (...parts: string[]): Phrase => parts.map((part) => part.split("|"));

/**
 * Frases de hecho consumado, en primera persona, por evento. Palabras enteras: «postule» no
 * matchea «postulantes» ni «postularme». Ni «oferta» ni «me ofrecieron» sueltos alcanzan para
 * `offer` («esta oferta» aparece en cualquier pedido sobre una oferta).
 */
const EVENT_PHRASES: Record<ManualJobEvent, readonly Phrase[]> = {
  apply: [
    p("me", "postule"),
    p("postule"),
    p("aplique"),
    p("me", "anote"),
    p("mande|envie", "el|mi", "cv|curriculum"),
    p("les", "mande|envie", "el|mi", "cv|curriculum"),
  ],
  interview: [
    p("entrevista|entrevistas"),
    p("me", "citaron"),
    p("segunda", "instancia"),
    p("siguiente", "etapa"),
    p("me", "llamaron", "para"),
  ],
  offer: [
    p("me", "ofrecieron", "el|un", "puesto|trabajo"),
    p("me", "hicieron", "la|una", "oferta|propuesta"),
    p("me", "mandaron|llego", "la|una", "propuesta|oferta"),
    p("acepte", "la", "oferta|propuesta"),
    p("me", "dieron", "el", "puesto"),
  ],
  reject: [
    p("me", "rechazaron"),
    p("no", "quede"),
    p("me", "bocharon"),
    p("me", "rebotaron"),
    p("no", "avance"),
    p("no", "sigo", "en", "el", "proceso"),
  ],
  auto_reject: [
    p("rechazo", "automatico"),
    p("mail", "automatico", "de", "rechazo"),
    p("me", "rechazaron", "automaticamente"),
  ],
  discard: [
    p("la", "descarte"),
    p("descartala"),
    p("no", "me", "interesa", "esta|la", "oferta"),
    p("no", "me", "sirve"),
  ],
  close: [
    p("cerraron", "la|el", "oferta|busqueda|aviso"),
    p("ya", "no", "esta", "publicada"),
    p("ya", "no", "esta", "el", "aviso"),
    p("la", "bajaron"),
  ],
};

/** Palabras que, justo antes de la frase clave, la vuelven negada, futura o hipotética. */
const NEGATORS = new Set([
  "no",
  "nunca",
  "ni",
  "sin",
  "todavia",
  "quiero",
  "queria",
  "quisiera",
  "deberia",
  "conviene",
  "si", // condicional («si me postulo…»); «sí» con acento es afirmación y no cuenta
  "capaz",
]);
const NEGATOR_PAIRS = [
  ["voy", "a"],
  ["vamos", "a"],
];
const NEGATION_WINDOW = 3;

function matchAt(words: readonly string[], at: number, phrase: Phrase): boolean {
  return phrase.every((options, k) => options.includes(words[at + k] ?? ""));
}

function negatedBefore(words: readonly string[], at: number): boolean {
  const window = words.slice(Math.max(0, at - NEGATION_WINDOW), at);
  if (window.some((w) => NEGATORS.has(w))) return true;
  return NEGATOR_PAIRS.some(([a, b]) => window.some((w, i) => w === a && window[i + 1] === b));
}

/** Oraciones del mensaje original, con su puntuación (la pregunta se reconoce por «¿» o «?»). */
function sentences(message: string): string[] {
  return message
    .split(/(?<=[.!?;\n])|(?=[¿¡])/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function indexOfSeq(haystack: readonly string[], needle: readonly string[]): number {
  if (needle.length === 0) return -1;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, k) => haystack[i + k] === w)) return i;
  }
  return -1;
}

/**
 * ¿La cita del modelo respalda el evento en el mensaje de la persona? Tiene que estar en una oración
 * que no sea pregunta, contener una frase clave del evento y esa frase no puede venir negada,
 * futura ni hipotética. Devuelve la oración original para mostrarla.
 */
export function eventEvidence(
  event: ManualJobEvent,
  quote: string,
  message: string,
): { sentence: string } | null {
  if (hasUnsafeChars(quote)) return null;
  const q = tokens(quote).map((w) => (w === "sí" ? "si" : w));
  if (q.length < 2 || q.join(" ").length < 8) return null;
  for (const sentence of sentences(message)) {
    const words = tokens(sentence);
    const plain = words.map((w) => (w === "sí" ? "si" : w));
    const start = indexOfSeq(plain, q);
    if (start < 0) continue;
    if (sentence.startsWith("¿") || sentence.endsWith("?")) return null;
    for (let i = start; i < start + q.length; i++) {
      const phrase = EVENT_PHRASES[event].find(
        (ph) => i + ph.length <= start + q.length && matchAt(plain, i, ph),
      );
      if (!phrase) continue;
      if (negatedBefore(words, i)) return null;
      return { sentence: sentence.slice(0, 300) };
    }
    return null;
  }
  return null;
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
  const evidence =
    source.from === "message" ? eventEvidence(event, source.quote, ctx.lastUserMessage) : null;
  if (!evidence) return fail("sin_fundamento", [{ field: "event", reason: "sin_fundamento" }]);
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
    sentence: evidence.sentence,
  });
}

// --- Alta de un aviso ---------------------------------------------------------------------------

/** Palabras de cada modalidad (plegadas) que la persona tiene que haber escrito. */
const MODALITY_WORDS: Record<Exclude<JobModality, "desconocida">, readonly string[]> = {
  remoto: ["remoto", "remota", "remote"],
  hibrido: ["hibrido", "hibrida", "hybrid"],
  presencial: ["presencial", "onsite"],
};

const URL_IN_TEXT = /https?:\/\/[^\s<>"'«»]{1,2000}/giu;

/** URLs que escribió la persona, ya normalizadas por `parseManualUrl` (nunca plegadas). */
function urlsIn(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const m of text.slice(0, 20_000).matchAll(URL_IN_TEXT)) {
      const parsed = parseManualUrl(m[0].replace(/[.,;:!?)\]]+$/u, ""));
      if (parsed.ok && parsed.url) out.add(parsed.url);
    }
  }
  return out;
}

/** Un email, un teléfono o un perfil de LinkedIn no son un título, una empresa ni una ubicación. */
function looksLikeContact(value: string): boolean {
  if (value.includes("@") || /linkedin\.com\/in\//iu.test(value)) return true;
  const digits = value.replace(/\D/gu, "");
  return digits.length >= 8 && digits.length <= 15 && /^[+\d\s().-]+$/u.test(value.trim());
}

/** Plegado sin colapsar espacios: lo que escribió la persona, sin acentos ni mayúsculas. */
const fold = (text: string) => foldText(text);

/** ¿La modalidad aparece afirmada (no «remoto no», «no es remoto», «sin remoto») en el texto? */
function modalityStated(modality: Exclude<JobModality, "desconocida">, text: string): boolean {
  const words = tokens(text).map((w) => (w === "sí" ? "si" : w));
  return words.some((w, i) => {
    if (!MODALITY_WORDS[modality].includes(w)) return false;
    const before = words.slice(Math.max(0, i - 2), i);
    return words[i + 1] !== "no" && !before.some((b) => b === "no" || b === "sin" || b === "nunca");
  });
}

export function buildNewJobAction(
  input: unknown,
  ctx: NewJobContext,
): Result<ActionProposal, ActionFailure> {
  const parsed = proposeNewJobInput.safeParse(input);
  if (!parsed.success) return fail("entrada_invalida");
  const v = parsed.data;
  const texts = ctx.userTexts.map(fold);
  const literal = (value: string): boolean => {
    const needle = fold(value);
    return needle.trim() !== "" && texts.some((t) => hasWord(t, needle));
  };

  for (const field of ["title", "company"] as const) {
    const value = v[field];
    if (hasUnsafeChars(value) || looksLikeContact(value)) {
      return fail("invalido", [{ field, reason: "invalido" }]);
    }
    if (!literal(value)) return fail("sin_fundamento", [{ field, reason: "sin_fundamento" }]);
  }
  if (
    v.source.from !== "message" ||
    !isGrounded(v.source, { userMessages: ctx.userTexts, profileTexts: [] })
  ) {
    return fail("sin_fundamento", [{ field: "source", reason: "sin_fundamento" }]);
  }

  const dropped: Dropped[] = [];
  let url: string | null = null;
  if (v.url !== undefined && v.url.trim() !== "") {
    const raw = v.url.trim();
    const checked = parseManualUrl(raw);
    if (hasUnsafeChars(raw) || !checked.ok || checked.url === null) {
      dropped.push({ field: "url", reason: "invalido" });
    } else if (!urlsIn(ctx.userTexts).has(checked.url)) {
      // Exacta: ni mayúsculas en el path ni un dominio parecido (exámple.com) pasan
      dropped.push({ field: "url", reason: "sin_fundamento" });
    } else {
      url = checked.url;
    }
  }

  let location: string | null = null;
  if (v.location !== undefined && v.location.trim() !== "") {
    const raw = v.location.trim();
    if (hasUnsafeChars(raw) || looksLikeContact(raw)) {
      dropped.push({ field: "location", reason: "invalido" });
    } else if (!literal(raw)) dropped.push({ field: "location", reason: "sin_fundamento" });
    else location = raw;
  }

  let modality: JobModality = "desconocida";
  const asked = v.modality;
  if (asked && asked !== "desconocida") {
    // Solo del mensaje que trae el título: la modalidad de otro aviso no cuenta
    const titled = ctx.userTexts.filter((t) => hasWord(fold(t), fold(v.title)));
    if (titled.some((t) => modalityStated(asked, t))) modality = asked;
    else dropped.push({ field: "modality", reason: "sin_fundamento" });
  }

  return ok({
    kind: "new_job",
    fields: { title: v.title, company: v.company, url, location, modality },
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

const projectDropped = (dropped: readonly Dropped[]): Dropped[] =>
  dropped.map((d) => ({ field: d.field, reason: d.reason }));

/**
 * Lo único de una acción que va a un log: tipo, evento (un enum), nombres de campo y motivos.
 * Nunca títulos, empresas, links ni citas.
 */
export function actionLogMeta(a: ActionProposal | ActionFailure): {
  kind?: ActionProposal["kind"];
  event?: ManualJobEvent;
  code?: ActionError;
  fields: string[];
  dropped: Dropped[];
} {
  if ("kind" in a) {
    if (a.kind === "status_change") {
      return { kind: a.kind, event: a.event, fields: ["event"], dropped: [] };
    }
    const fields = (Object.keys(a.fields) as (keyof NewJobAction["fields"])[]).filter(
      (k) => a.fields[k] !== null && a.fields[k] !== "desconocida",
    );
    return { kind: a.kind, fields, dropped: projectDropped(a.dropped) };
  }
  return { code: a.code, fields: [], dropped: projectDropped(a.dropped) };
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
  return JSON.stringify({
    tarjeta_lista: false,
    motivo: out.code,
    descartados: projectDropped(out.dropped),
  });
}
