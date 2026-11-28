import { schema as s, type Db } from "@job-search-os/db";
import {
  JOB_CARD_PROMPT,
  JOB_CARD_SCHEMA_VERSION,
  JOB_CARD_TASK,
  JobCardSchema,
  buildJobCardPromptVars,
  finalizeJobCard,
  hasEnoughJobText,
  jobCardAllowed,
  jobCardGenerationEnabled,
  jobCardMode,
  jobCardHasContent,
  jobCardHash,
  jobCardReservationLabel,
  jobCardWire,
  type JobCard,
  type RequirementAnswer,
} from "@job-search-os/pipeline";
import { eq, sql } from "drizzle-orm";
import {
  releaseJobCardReservation,
  reserveJobCard,
  type JobCardReserveInput,
} from "../llm/job-card-reserve";
import type { LlmClient } from "../llm/types";
import type { Logger } from "../logger";
import { safeDbError } from "../logging/safe-error";
import { fillMissingJdHash } from "./jd-hash";

/**
 * Genera la ficha de un aviso una sola vez por texto (R31-03, ADR-048). Lo usan el worker de evaluación (siempre
 * antes de evaluar) y la pantalla de detalle (a pedido, la primera vez que alguien abre un aviso sin ficha).
 *
 * `db` es la conexión de servicio: la ficha no es de nadie y la escribe el proceso que la genera. El modelo
 * propone; el código decide: la salida pasa por el esquema estricto y por `finalizeJobCard` (cada cita verificada
 * contra el texto que viajó). Sin texto suficiente no se llama al modelo.
 *
 * Una sola vez por hash: la reserva con la etiqueta `job_card:<hash>` hace que, mientras un pedido genera, los
 * demás reciban `preparando` sin llamar al modelo; la restricción única de `job_cards.jd_hash` y el
 * `on conflict` son el respaldo.
 */
export type EnsureJobCardDeps = {
  db: Db;
  llm: LlmClient;
  logger: Logger;
  now?: () => Date;
  signal?: AbortSignal;
  /** Para tests: topes y tope global. */
  reserve?: Pick<JobCardReserveInput, "caps" | "globalCapUsd" | "lockTimeoutMs">;
};

export type EnsureJobCardResult =
  | { status: "lista"; generated: boolean }
  | { status: "sin_texto" }
  | { status: "fallida"; errorCode: string | null }
  | { status: "tope"; reason: "daily_count" | "daily_usd" | "global" }
  /** Otro pedido la está generando ahora mismo. */
  | { status: "preparando" };

const shortCode = (code: string): string => code.replace(/[^a-z0-9_:.-]/gi, "_").slice(0, 60);

export async function ensureJobCard(
  deps: EnsureJobCardDeps,
  input: { text: string | null; retry?: boolean },
): Promise<EnsureJobCardResult> {
  const { db } = deps;
  const text = input.text ?? "";
  const hash = jobCardHash(text);
  const log = deps.logger.child({ job_card: hash.slice(0, 12) });
  const now = deps.now ?? (() => new Date());

  if (!hasEnoughJobText(text)) {
    // Sin texto suficiente no se llama al modelo. Se anota (una sola vez) solo si hay algo de texto.
    if (text.trim() !== "") {
      await db
        .insert(s.jobCards)
        .values({ jdHash: hash, status: "sin_texto", createdAt: now(), updatedAt: now() })
        .onConflictDoNothing({ target: s.jobCards.jdHash });
    }
    return { status: "sin_texto" };
  }

  const reservation = await reserveJobCard(db, {
    hash,
    retry: input.retry ?? false,
    now,
    ...deps.reserve,
  });
  if (!reservation.ok) {
    switch (reservation.reason) {
      case "exists": {
        const [row] = await db
          .select({ status: s.jobCards.status, errorCode: s.jobCards.errorCode })
          .from(s.jobCards)
          .where(eq(s.jobCards.jdHash, hash))
          .limit(1);
        if (row?.status === "lista") return { status: "lista", generated: false };
        if (row?.status === "sin_texto") return { status: "sin_texto" };
        return { status: "fallida", errorCode: row?.errorCode ?? null };
      }
      case "in_flight":
        return { status: "preparando" };
      case "lock_timeout":
        // Servicio saturado: se dice como tope global y la pantalla ofrece reintentar más tarde
        return { status: "tope", reason: "global" };
      default:
        return { status: "tope", reason: reservation.reason };
    }
  }

  try {
    const { vars, text: sent } = buildJobCardPromptVars(text);
    const generated = await deps.llm.generateStructured(JOB_CARD_TASK, JobCardSchema, vars, {
      promptVersion: JOB_CARD_PROMPT,
      label: jobCardReservationLabel(hash),
      wire: jobCardWire,
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
    if (!generated.ok) {
      // El detalle del error del cliente puede citar el aviso o la respuesta: solo va el tipo
      log.error({ kind: generated.error.kind }, "ficha del aviso: el modelo falló");
      await saveFailed(db, hash, shortCode(`llm_${generated.error.kind}`), now());
      return { status: "fallida", errorCode: shortCode(`llm_${generated.error.kind}`) };
    }
    const finalized = finalizeJobCard(generated.value.object, sent);
    if (!finalized.ok) {
      log.error({ code: finalized.error }, "ficha del aviso: salida inválida");
      await saveFailed(db, hash, finalized.error, now());
      return { status: "fallida", errorCode: finalized.error };
    }
    const { card, dropped, adjusted, injectionSuspected } = finalized.value;
    // Solo conteos y motivos: nunca el texto del aviso ni de la ficha
    log.info(
      {
        dropped: dropped.length,
        adjusted: adjusted.length,
        reasons: [...new Set(dropped.map((d) => d.reason))],
        model: generated.value.model,
      },
      "ficha del aviso generada",
    );
    if (injectionSuspected) log.warn("ficha del aviso: el aviso trae instrucciones para el modelo");
    if (!jobCardHasContent(card)) {
      await saveFailed(db, hash, "sin_contenido", now());
      return { status: "fallida", errorCode: "sin_contenido" };
    }
    await saveReady(db, hash, card, generated.value.model, now());
    return { status: "lista", generated: true };
  } catch (e) {
    log.error({ err: safeDbError(e) }, "ficha del aviso: falló al generar o guardar");
    try {
      await saveFailed(db, hash, "error_interno", now());
    } catch {
      // ya está logueado; la reserva vence sola
    }
    return { status: "fallida", errorCode: "error_interno" };
  } finally {
    // Primero queda guardada la ficha (o la falla) y recién después se suelta la reserva
    await releaseJobCardReservation(db, reservation.reservationId);
  }
}

async function saveReady(
  db: Db,
  hash: string,
  card: JobCard,
  model: string,
  at: Date,
): Promise<void> {
  const values = {
    status: "lista",
    card,
    schemaVersion: JOB_CARD_SCHEMA_VERSION,
    promptVersion: JOB_CARD_PROMPT,
    model,
    errorCode: null,
    area: card.area?.valor ?? null,
    jdLanguage: card.idioma.valor,
    englishLevel: card.condiciones.ingles?.nivel ?? null,
    modality: card.condiciones.modalidad?.valor ?? null,
    updatedAt: at,
  };
  await db
    .insert(s.jobCards)
    .values({ ...values, jdHash: hash, attempts: 1, createdAt: at })
    .onConflictDoUpdate({
      target: s.jobCards.jdHash,
      set: { ...values, attempts: sql`${s.jobCards.attempts} + 1` },
      // Solo reemplaza una fallida (reintento): una ficha lista no se pisa nunca
      setWhere: eq(s.jobCards.status, "fallida"),
    });
}

async function saveFailed(db: Db, hash: string, code: string, at: Date): Promise<void> {
  await db
    .insert(s.jobCards)
    .values({
      jdHash: hash,
      status: "fallida",
      errorCode: code,
      attempts: 1,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoUpdate({
      target: s.jobCards.jdHash,
      set: { errorCode: code, attempts: sql`${s.jobCards.attempts} + 1`, updatedAt: at },
      setWhere: eq(s.jobCards.status, "fallida"),
    });
}

/**
 * ¿Esta cuenta ve la ficha (`jobCardAllowed`)? Para el worker, que no tiene sesión: busca el email de la cuenta con
 * la conexión de servicio. Falla cerrado ante cualquier error o cuenta inexistente. (Los testers por rol en la base
 * no se miran acá: a ellos la ficha se les genera a pedido al abrir el detalle.)
 */
export async function jobCardAllowedForUser(
  db: Db,
  userId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const mode = jobCardMode(env);
  if (mode === "off") return false;
  if (mode === "all") return true;
  try {
    const [u] = await db
      .select({ email: s.users.email })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1);
    return jobCardAllowed(env, u?.email ?? null);
  } catch {
    return false;
  }
}

/**
 * Lo que la evaluación lee de la ficha (R31-03): la ficha verificada del texto y las respuestas de un toque de la
 * persona. Solo con `JOB_CARD` encendida; sin ficha lista devuelve `jobCard: null` (el prompt dice «FICHA NO
 * DISPONIBLE» y la tabla queda como antes). Nunca lanza. `db` es la conexión de servicio: filtro explícito por dueño.
 */
export async function loadJobCardForEvaluation(
  db: Db,
  input: { jdText: string | null; userId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ jobCard: JobCard | null; requirementAnswers: Map<string, RequirementAnswer> }> {
  const empty = { jobCard: null, requirementAnswers: new Map<string, RequirementAnswer>() };
  if (!jobCardGenerationEnabled(env) || !input.jdText?.trim()) return empty;
  try {
    if (!(await jobCardAllowedForUser(db, input.userId, env))) return empty;
    const [row] = await db
      .select({ status: s.jobCards.status, card: s.jobCards.card })
      .from(s.jobCards)
      .where(eq(s.jobCards.jdHash, jobCardHash(input.jdText)))
      .limit(1);
    const parsed = row?.status === "lista" ? JobCardSchema.safeParse(row.card) : null;
    if (!parsed?.success) return empty;
    const answers = await db
      .select({
        key: s.requirementAnswers.reqKey,
        answer: s.requirementAnswers.answer,
        note: s.requirementAnswers.note,
      })
      .from(s.requirementAnswers)
      .where(eq(s.requirementAnswers.userId, input.userId));
    const requirementAnswers = new Map<string, RequirementAnswer>();
    for (const a of answers) {
      if (a.answer === "si" || a.answer === "no" || a.answer === "en_parte") {
        requirementAnswers.set(a.key, { valor: a.answer, nota: a.note });
      }
    }
    return { jobCard: parsed.data, requirementAnswers };
  } catch {
    return empty;
  }
}

/**
 * La ficha antes de evaluar (R31-03). Solo con `JOB_CARD` encendida; **nunca** frena ni rompe la evaluación: ante
 * cualquier problema se loguea y la evaluación sigue como antes.
 */
export async function ensureJobCardBeforeEvaluation(
  deps: EnsureJobCardDeps,
  job: { id: string; userId: string; jdText: string | null; jdHash: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<EnsureJobCardResult | null> {
  if (!jobCardGenerationEnabled(env)) return null;
  try {
    // Solo para cuentas que ven la ficha (falla cerrado): con `testers` no se gasta en la oferta de cualquiera
    if (!(await jobCardAllowedForUser(deps.db, job.userId, env))) return null;
    // Ofertas viejas con `jd_hash` nulo: se completa para que la RLS una la oferta con su ficha
    if (!job.jdHash) await fillMissingJdHash(deps.db, job.id, job.jdText);
    return await ensureJobCard(deps, { text: job.jdText });
  } catch (e) {
    deps.logger.error(
      { err: safeDbError(e) },
      "ficha del aviso: no se pudo preparar antes de evaluar",
    );
    return null;
  }
}
