import type { Db } from "@job-search-os/db";
import { sql } from "drizzle-orm";

/**
 * Estado operativo para `/api/cron/status` (ronda 69, I-6). Un monitor externo mira el código HTTP
 * (503 si algo no está ok). Solo agregados: nunca emails, ids de usuario, títulos ni empresas.
 * Las fuentes salen del enum `source_kind` (texto cerrado), no de datos de personas.
 */

/** El cron del pool corre cada 6 h: 13 h son dos corridas perdidas más margen. */
export const POOL_STALE_MAX_HOURS = 13;
/** Un pendiente elegible hace más de 26 h significa que el worker no está vaciando la cola. */
export const QUEUE_OLDEST_MAX_HOURS = 26;
/** Más de tantos mensajes `failed` en 24 h hacen fallar `queue_failed_24h_max`. */
export const QUEUE_FAILED_24H_MAX = 10;
/** O más de esta fracción de los intentos de 24 h (terminados: done + failed)... */
export const QUEUE_FAILED_RATIO_MAX = 0.5;
/** ...siempre que haya al menos tantos intentos (con menos, el porcentaje no dice nada). */
export const QUEUE_FAILED_RATIO_MIN_ATTEMPTS = 4;
/** Con pendientes, una última evaluación de hace más de esto (misma cifra que la cola vieja). */
export const EVALUATION_IDLE_MAX_HOURS = 26;
/** Porcentaje de llamadas de `evaluate_job` de 24 h respondidas por el respaldo que hace fallar el check. */
export const LLM_FALLBACK_MAX_PCT = 50;
/** Mínimo de llamadas de 24 h para que el porcentaje de respaldo cuente. */
export const LLM_FALLBACK_MIN_CALLS = 10;
/** Descargas seguidas en error de una misma fuente que hacen fallar el check. */
export const SOURCE_CONSECUTIVE_ERRORS_MAX = 3;
/** Cuántas descargas recientes por fuente alcanza para ver la racha de errores. */
export const FETCHES_PER_SOURCE = SOURCE_CONSECUTIVE_ERRORS_MAX;

export type StatusFetch = {
  startedAt: Date;
  status: string;
  errorCode: string | null;
  fetched: number;
  inserted: number;
};

export type StatusSnapshot = {
  /** max(public_jobs.last_seen_at); null si el pool está vacío. */
  poolLastSeenAt: Date | null;
  /** Por fuente, las últimas descargas, la más nueva primero. */
  sources: { source: string; recent: StatusFetch[] }[];
  queue: {
    pending: number;
    /** Mensajes en `failed` actualizados en las últimas 24 h. */
    failed24h: number;
    /** Mensajes terminados (`done` o `failed`) en las últimas 24 h; ausente = sin dato. */
    attempts24h?: number;
    /** Minutos desde que el pendiente más viejo es elegible (run_after); null si no hay. */
    oldestPendingMinutes: number | null;
  };
  /** max(evaluations.created_at); solo la fecha, sin saber de quién. */
  lastEvaluationAt: Date | null;
  /** Llamadas de `evaluate_job` de 24 h y cuántas respondió el modelo de respaldo; solo conteos. */
  llm?: { calls24h: number; fallback24h: number };
};

export type StatusCheck = {
  name: string;
  ok: boolean;
  value: number | string | null;
  threshold: number | null;
};

export type StatusReport = { ok: boolean; checks: StatusCheck[] };

/** Secret que rige en `/api/cron/status`: STATUS_TOKEN si está definido y no vacío; si no, CRON_SECRET. */
export function statusExpectedSecret(env: {
  STATUS_TOKEN?: string;
  CRON_SECRET?: string;
}): string | undefined {
  return env.STATUS_TOKEN || env.CRON_SECRET;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Cuántas descargas seguidas en error hay desde la más nueva (la lista viene newest-first). */
export function consecutiveErrors(recent: readonly StatusFetch[]): number {
  let n = 0;
  for (const f of recent) {
    if (f.status !== "error") break;
    n++;
  }
  return n;
}

/** Lógica de umbrales, pura: `now` entra por parámetro. */
export function evaluateStatus(snapshot: StatusSnapshot, now: Date): StatusReport {
  const checks: StatusCheck[] = [];

  const poolHours = snapshot.poolLastSeenAt
    ? round1((now.getTime() - snapshot.poolLastSeenAt.getTime()) / 3_600_000)
    : null;
  checks.push({
    name: "pool_freshness_hours",
    // Pool vacío o sin fecha: no hay evidencia de que el cron esté andando
    ok: poolHours !== null && poolHours <= POOL_STALE_MAX_HOURS,
    value: poolHours,
    threshold: POOL_STALE_MAX_HOURS,
  });

  const oldestHours =
    snapshot.queue.oldestPendingMinutes === null
      ? null
      : round1(snapshot.queue.oldestPendingMinutes / 60);
  checks.push({
    name: "queue_oldest_pending_hours",
    ok: oldestHours === null || oldestHours <= QUEUE_OLDEST_MAX_HOURS,
    value: oldestHours,
    threshold: QUEUE_OLDEST_MAX_HOURS,
  });

  for (const src of snapshot.sources) {
    const streak = consecutiveErrors(src.recent);
    checks.push({
      name: `source_consecutive_errors:${src.source}`,
      ok: streak < SOURCE_CONSECUTIVE_ERRORS_MAX,
      value: streak,
      threshold: SOURCE_CONSECUTIVE_ERRORS_MAX,
    });
  }

  const { failed24h } = snapshot.queue;
  const attempts = snapshot.queue.attempts24h ?? 0;
  const failedRatioHigh =
    attempts >= QUEUE_FAILED_RATIO_MIN_ATTEMPTS && failed24h / attempts > QUEUE_FAILED_RATIO_MAX;
  checks.push({
    name: "queue_failed_24h_max",
    ok: failed24h <= QUEUE_FAILED_24H_MAX && !failedRatioHigh,
    value: failed24h,
    threshold: QUEUE_FAILED_24H_MAX,
  });

  // Pendientes y sin evaluar hace mucho (o nunca): el worker no avanza. Cola vacía: nunca falla.
  const idleHours = snapshot.lastEvaluationAt
    ? round1((now.getTime() - snapshot.lastEvaluationAt.getTime()) / 3_600_000)
    : null;
  checks.push({
    name: "evaluation_idle_hours",
    ok:
      snapshot.queue.pending === 0 ||
      (idleHours !== null && idleHours <= EVALUATION_IDLE_MAX_HOURS),
    value: idleHours,
    threshold: EVALUATION_IDLE_MAX_HOURS,
  });

  const llmCalls = snapshot.llm?.calls24h ?? 0;
  const fallbackPct =
    llmCalls > 0 ? round1(((snapshot.llm?.fallback24h ?? 0) / llmCalls) * 100) : null;
  checks.push({
    name: "llm_fallback_24h",
    ok: !(
      llmCalls >= LLM_FALLBACK_MIN_CALLS &&
      fallbackPct !== null &&
      fallbackPct > LLM_FALLBACK_MAX_PCT
    ),
    value: fallbackPct,
    threshold: LLM_FALLBACK_MAX_PCT,
  });

  // Informativos: no tumban el estado, sirven para leer el JSON a mano
  checks.push({ name: "queue_pending", ok: true, value: snapshot.queue.pending, threshold: null });
  checks.push({
    name: "queue_failed_24h",
    ok: true,
    value: snapshot.queue.failed24h,
    threshold: null,
  });
  checks.push({
    name: "last_evaluation_at",
    ok: true,
    value: snapshot.lastEvaluationAt ? snapshot.lastEvaluationAt.toISOString() : null,
    threshold: null,
  });

  return { ok: checks.every((c) => c.ok), checks };
}

const toDate = (v: unknown): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Lee los agregados con la conexión de servicio (rol dueño, saltea RLS): por eso las consultas son
 * solo SELECT de agregados, sin columnas de usuarios.
 * `max(evaluations.created_at)` recorre la tabla: si crece, conviene un índice `evaluations(created_at)`.
 */
export async function readStatusSnapshot(db: Db, now: Date): Promise<StatusSnapshot> {
  const nowIso = now.toISOString();

  const [pool] = (await db.execute(
    sql`select max(last_seen_at) as last_seen from public_jobs`,
  )) as unknown as { last_seen: unknown }[];

  const [queue] = (await db.execute(sql`
    select
      count(*) filter (where status = 'pending')::int as pending,
      count(*) filter (
        where status = 'failed' and updated_at > ${nowIso}::timestamptz - interval '24 hours'
      )::int as failed_24h,
      count(*) filter (
        where status in ('done', 'failed') and updated_at > ${nowIso}::timestamptz - interval '24 hours'
      )::int as attempts_24h,
      (extract(epoch from (
        ${nowIso}::timestamptz - min(run_after) filter (
          where status = 'pending' and run_after <= ${nowIso}::timestamptz
        )
      )) / 60)::float8 as oldest_pending_minutes
    from job_queue
    where queue = 'evaluate_job'
  `)) as unknown as {
    pending: number;
    failed_24h: number;
    attempts_24h: number;
    oldest_pending_minutes: number | null;
  }[];

  // Cada intento (primario o respaldo) deja una fila con su modelo: respaldo = el modelo de la ruta.
  const [llm] = (await db.execute(sql`
    select
      count(*)::int as calls,
      count(*) filter (where c.model = r.fallback_model)::int as fallback
    from llm_calls c
    left join model_routing r on r.task = c.task
    where c.task = 'evaluate_job' and c.created_at > ${nowIso}::timestamptz - interval '24 hours'
  `)) as unknown as { calls: number; fallback: number }[];

  const [evaluation] = (await db.execute(
    sql`select max(created_at) as last_at from evaluations`,
  )) as unknown as { last_at: unknown }[];

  const fetchRows = (await db.execute(sql`
    select source_kind, started_at, status, error_code, fetched, inserted
    from (
      select *, row_number() over (partition by source_kind order by started_at desc) as rn
      from public_job_fetches
      where started_at > ${nowIso}::timestamptz - interval '7 days'
    ) t
    where rn <= ${FETCHES_PER_SOURCE}
    order by source_kind, started_at desc
  `)) as unknown as {
    source_kind: string;
    started_at: unknown;
    status: string;
    error_code: string | null;
    fetched: number;
    inserted: number;
  }[];

  const bySource = new Map<string, StatusFetch[]>();
  for (const r of fetchRows) {
    const startedAt = toDate(r.started_at);
    if (!startedAt) continue;
    const list = bySource.get(r.source_kind) ?? [];
    list.push({
      startedAt,
      status: r.status,
      errorCode: r.error_code,
      fetched: r.fetched,
      inserted: r.inserted,
    });
    bySource.set(r.source_kind, list);
  }

  return {
    poolLastSeenAt: toDate(pool?.last_seen),
    sources: [...bySource].map(([source, recent]) => ({ source, recent })),
    queue: {
      pending: queue?.pending ?? 0,
      failed24h: queue?.failed_24h ?? 0,
      attempts24h: queue?.attempts_24h ?? 0,
      oldestPendingMinutes: queue?.oldest_pending_minutes ?? null,
    },
    lastEvaluationAt: toDate(evaluation?.last_at),
    llm: { calls24h: llm?.calls ?? 0, fallback24h: llm?.fallback ?? 0 },
  };
}
