import { schema as s, type Db } from "@job-search-os/db";
import {
  buildCvPromptVars,
  cvExtractionSchema,
  cvSkillCandidates,
  detectCvInjection,
  err,
  isRoleKey,
  normalizeCvExtraction,
  normalizeCvText,
  ok,
  ROLE_KEYS,
  redactCvText,
  sniffCvFile,
  type CvProposal,
  type Result,
  type RoleKey,
  type SkillTaxonomyEntry,
} from "@job-search-os/pipeline";
import { and, eq, gte, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Logger } from "../logger";
import type { LlmClient } from "../llm/types";

/**
 * Orquestación de la lectura del CV (CV-03, diseño de la ronda 81 §3.1 pasos 6-14). El texto llega ya
 * extraído en el navegador; acá se vuelve a normalizar y redactar (el cliente no se cree), se detecta
 * inyección, se arman las candidatas y se llama al modelo. El modelo propone y el código verifica.
 * No escribe nada propio: solo `llm_calls`, que registra el cliente LLM. FALLA CERRADO en todo.
 *
 * Logs: solo `user_id`, códigos y conteos. Nunca el texto del CV, la salida del modelo ni el nombre del
 * archivo.
 */

/** Tarea LLM registrada en `model_routing` (fila del CV-02). El nombre del modelo NO vive acá. */
export const EXTRACT_CV_TASK = "extract_cv_profile";

export type CvPlan = "free" | "paid";

/**
 * Lecturas por persona y por mes (decisión 5 de Mauro, 13/11, ADR-034 §6): gratis 3, pago 10. Es el mismo
 * número que `plans.ts` (`cvReadsPerMonth`) y que `PROFILE_AGENT_READS_PER_MONTH`.
 */
export const CV_MONTHLY_LIMIT: Readonly<Record<CvPlan, number>> = { free: 3, paid: 10 };

/** Ventana móvil del tope mensual, como la de 24 h de `spend.ts`: no se resetea a mitad de mes. */
export const CV_LIMIT_WINDOW_DAYS = 30;
export const CV_LLM_TIMEOUT_MS = 45_000;
const MAX_ROLES = 5;

export type CvExtractErrorCode =
  | "disabled"
  | "limit_reached"
  | "cap_global"
  | "cap_user"
  | "in_progress"
  | "usage_unavailable"
  | "file_rejected"
  | "text_too_short"
  | "text_too_long"
  | "redaction_failed"
  | "injection_detected"
  | "no_route"
  | "timeout"
  | "aborted"
  | "llm_failed"
  | "output_invalid"
  | "sensitive_output";

/** Error tipado: el código es cerrado y no lleva contenido del CV. */
export type CvExtractError = { code: CvExtractErrorCode };

/** Cuenta las lecturas de CV de una persona desde una fecha (ok o no: una que falla también cuesta). */
export interface CvUsageSource {
  countSince(userId: string, since: Date): Promise<number>;
}

/**
 * Una lectura que se cortó por tiempo (o que se canceló) no consume cupo: decisión de Mauro del
 * 21/10. Tampoco `provider_unavailable` (primario sin clave: no se llamó, no costó nada; el
 * cliente lo registra desde C-24 y sin esto una lectura gastaría dos cupos). El resto de los fallos del proveedor sí cuenta (pueden haber costado).
 */
export const CV_ERRORS_NOT_COUNTED = ["timeout", "aborted", "provider_unavailable"] as const;

/**
 * Reusa el patrón de `spend.ts`: filas de `llm_calls` por `user_id` y `task`, con el índice
 * `llm_calls_user_task`. `db` tiene que ver `llm_calls` de la persona (conexión de servicio).
 */
export function drizzleCvUsage(db: Db): CvUsageSource {
  return {
    async countSince(userId, since) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, userId),
            eq(s.llmCalls.task, EXTRACT_CV_TASK),
            gte(s.llmCalls.createdAt, since),
            or(isNull(s.llmCalls.error), notInArray(s.llmCalls.error, [...CV_ERRORS_NOT_COUNTED])),
          ),
        );
      return row?.n ?? 0;
    },
  };
}

export type ExtractCvInput = {
  /** Siempre sale de la sesión, nunca del cliente. */
  userId: string;
  /** Texto del CV tal como lo leyó el navegador (se vuelve a normalizar y redactar acá). */
  text: string;
  /** Bytes del archivo, solo si algún día se lee en el servidor: se verifica el tipo por contenido. */
  file?: Uint8Array;
  /** `profiles.display_name`, para redactarlo. */
  displayName?: string | null;
  /** Puestos tildados (se filtran con `isRoleKey`). */
  roles: readonly string[];
  taxonomy: readonly SkillTaxonomyEntry[];
  /** Slugs de `role_skills` de los puestos tildados, para completar las candidatas. */
  roleSkillSlugs?: readonly string[];
  /** `llm_calls.label` de la llamada (el agente de perfil usa `cv:<flowId>`); sin él, null. */
  label?: string;
};

export type ExtractCvDeps = {
  llm: LlmClient;
  usage: CvUsageSource;
  logger: Logger;
  /**
   * Chequeo de topes de USD (global y por persona); típico: `() => spendCapReason(db, { userId })`.
   * Obligatorio: es el único freno de gasto ante carreras entre instancias. Si falta, falla cerrado.
   */
  capGuard: () => Promise<"global" | "user" | null>;
  /** Fecha actual inyectada: el servidor no usa reloj implícito. */
  now: () => Date;
  /** Por defecto lee `CV_IMPORT_ENABLED` de `process.env`: solo "1" lo enciende. */
  env?: Record<string, string | undefined>;
  /**
   * Plan de la persona. Hoy no existe el concepto de plan en la base: si no se pasa, vale "free" para
   * todos (ver informe). Cuando exista, la Server Action lo resuelve y lo inyecta acá.
   */
  plan?: CvPlan;
  timeoutMs?: number;
};

/** `CV_IMPORT_ENABLED` se comprueba en el servidor: ausente o distinto de "1" = apagado. */
export function cvImportEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CV_IMPORT_ENABLED === "1";
}

/**
 * Lectura con cupo mensual y topes de USD medidos acá (`deps.usage` y `deps.capGuard`). Ya no hay registro
 * de lecturas en curso en memoria: no cubría dos instancias (ADR-034 §6). La exclusión por persona la da
 * la reserva con lock de `readCvForAgent`.
 */
export async function extractCvProfile(
  input: ExtractCvInput,
  deps: ExtractCvDeps,
): Promise<Result<CvProposal, CvExtractError>> {
  return extractWith(input, deps, true);
}

/**
 * Misma lectura sin medir cupo ni USD: **el llamador ya los midió y reservó** bajo lock
 * (`readCvForAgent`). No se exporta por el índice público de otra forma: quien la use sin reservar se
 * saltea los topes.
 */
export async function extractCvProfileReserved(
  input: ExtractCvInput,
  deps: Omit<ExtractCvDeps, "usage" | "capGuard" | "plan">,
): Promise<Result<CvProposal, CvExtractError>> {
  return extractWith(input, deps, false);
}

async function extractWith(
  input: ExtractCvInput,
  deps: Omit<ExtractCvDeps, "usage" | "capGuard"> &
    Partial<Pick<ExtractCvDeps, "usage" | "capGuard">>,
  metered: boolean,
): Promise<Result<CvProposal, CvExtractError>> {
  const log = deps.logger.child({ user_id: input.userId, task: EXTRACT_CV_TASK });
  const fail = (code: CvExtractErrorCode, extra: Record<string, unknown> = {}) => {
    log.warn({ code, ...extra }, "cv_extract_rechazado");
    return err<CvExtractError>({ code });
  };

  // 1. Flag (apagado por defecto): no hace nada más
  if (!cvImportEnabled(deps.env ?? process.env)) return fail("disabled");
  return run(input, deps, log, fail, metered);
}

async function run(
  input: ExtractCvInput,
  deps: Omit<ExtractCvDeps, "usage" | "capGuard"> &
    Partial<Pick<ExtractCvDeps, "usage" | "capGuard">>,
  log: Logger,
  fail: (
    code: CvExtractErrorCode,
    extra?: Record<string, unknown>,
  ) => Result<never, CvExtractError>,
  metered: boolean,
): Promise<Result<CvProposal, CvExtractError>> {
  const startedAt = deps.now();

  // 3. Archivo (si viene): tipo por contenido y tamaño, antes de gastar nada
  if (input.file !== undefined) {
    const sniff = sniffCvFile(input.file);
    if (!sniff.ok) return fail("file_rejected", { reason: sniff.error });
  }

  // 4. Texto: normalización y límites (el cliente no se cree)
  const normalized = normalizeCvText(input.text);
  if (!normalized.ok) {
    return fail(normalized.error === "too_short" ? "text_too_short" : "text_too_long", {
      chars: input.text.length,
    });
  }

  // 5. Topes: mensual por persona y de USD. Si no se puede contar, falla cerrado
  const plan: CvPlan = deps.plan ?? "free";
  let used = 0;
  if (metered) {
    const limit = CV_MONTHLY_LIMIT[plan];
    const since = new Date(startedAt.getTime() - CV_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    try {
      // Sin `usage` no se sigue: falla cerrado
      if (!deps.usage) return fail("usage_unavailable");
      used = await deps.usage.countSince(input.userId, since);
    } catch {
      return fail("usage_unavailable");
    }
    if (used >= limit) return fail("limit_reached", { plan, used, limit });
    // Sin chequeo de USD no se sigue (si una llamada lo omite por error, no queda sin freno)
    if (typeof deps.capGuard !== "function") return fail("usage_unavailable");
    let reason: "global" | "user" | null;
    try {
      reason = await deps.capGuard();
    } catch {
      return fail("usage_unavailable");
    }
    if (reason !== null) return fail(reason === "global" ? "cap_global" : "cap_user");
  }

  // 6. Redacción de datos personales (con reglas, antes de cualquier LLM). Falla cerrado
  const redacted = redactCvText(normalized.value, { displayName: input.displayName });
  if (!redacted.ok) return fail("redaction_failed");
  const text = redacted.value.text;

  // 7. Detector de inyección: si salta, falla cerrado y NO se llama al modelo
  const injection = detectCvInjection(text);
  if (injection.hit) return fail("injection_detected", { signals: injection.signals });

  // 8. Candidatas de skills y variables del prompt
  const roles: RoleKey[] = [];
  for (const r of input.roles) {
    if (isRoleKey(r) && !roles.includes(r) && roles.length < MAX_ROLES) roles.push(r);
  }
  const candidates = cvSkillCandidates(text, input.taxonomy, input.roleSkillSlugs ?? []);
  const today = startedAt.toISOString().slice(0, 10);
  const vars = buildCvPromptVars({
    text,
    roleLabels: roles.length > 0 ? roles : ["no especificado"],
    candidates,
    today: today.slice(0, 7),
  });
  // El prompt de la lectura pide también las claves de puestos válidas (una sola fuente: `ROLE_KEYS`)
  const promptVars = { ...vars, role_keys: ROLE_KEYS.join(", ") };

  // 9. LLM con `signal`: el timeout corta la llamada (el cliente no reintenta con fallback si se cortó)
  const timeoutMs = deps.timeoutMs ?? CV_LLM_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let result: Awaited<ReturnType<LlmClient["generateStructured"]>>;
  try {
    result = await deps.llm.generateStructured(EXTRACT_CV_TASK, cvExtractionSchema, promptVars, {
      userId: input.userId,
      signal: controller.signal,
      ...(input.label ? { label: input.label } : {}),
    });
  } catch {
    // Borde: el cliente real no lanza, pero un LLM inyectado sí podría. Nunca se loguea el error crudo.
    return fail(timedOut ? "timeout" : "llm_failed");
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok) {
    const kind = result.error.kind;
    if (kind === "no_route") return fail("no_route");
    if (kind === "aborted") return fail(timedOut ? "timeout" : "aborted");
    return fail("llm_failed", { llm_kind: kind });
  }

  // 10. Normalización: el código verifica lo que propuso el modelo
  const proposal = normalizeCvExtraction(result.value.object, { text, candidates, today });
  if (!proposal.ok) {
    return fail(proposal.error === "sensitive_output" ? "sensitive_output" : "output_invalid");
  }

  log.info(
    {
      code: "ok",
      plan,
      used_in_window: metered ? used + 1 : null,
      chars: text.length,
      redactions: redacted.value.counts,
      candidates: candidates.length,
      skills: proposal.value.skills.length,
      skills_verified: proposal.value.skills.filter((k) => k.verified).length,
      dropped: proposal.value.flags.dropped,
      summary_injection: proposal.value.flags.summaryInjection,
      used_fallback: result.value.usedFallback,
      latency_ms: result.value.latencyMs,
    },
    "cv_extract_ok",
  );
  return ok(proposal.value);
}
