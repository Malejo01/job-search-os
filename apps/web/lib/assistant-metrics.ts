import { ASSISTANT_TASK, createLogger, safeDbError } from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import {
  aggregateAssistantDays,
  ASSISTANT_EVENT_TASK,
  ASSISTANT_TURN_MARKER,
  type AssistantDayMetrics,
  type ConversationSample,
} from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { canCreateInvitations } from "./invitations";

/**
 * Medición del asistente por día (R9-2), solo servidor y solo admins: lo mismo que `/settings/salud`.
 * Agrega entre personas, así que va por la conexión de servicio, con `statement_timeout` de 3 s y
 * caché de 5 minutos. Agrupa `llm_calls` por charla (`label = conv:<id>`) y devuelve solo números:
 * ni el id de la charla, ni ids de personas, ni contenido (las charlas no se guardan).
 *
 * Fuentes por charla: costo = suma de `cost_usd` de sus filas; mensajes = filas de la tarea
 * `assistant_event` con `prompt_version = 'turn'` (una por turno aceptado); cortes = las de
 * `prompt_version like 'cap:%'`. Las charlas anteriores a los marcadores no tienen mensajes medidos
 * (null) y solo aportan costo.
 */
const DAYS = 7;
/** Argentina no tiene horario de verano: UTC−3 fijo. */
const AR_OFFSET_MINUTES = -180;

type Row = {
  started_at: Date | string;
  cost: number | string | null;
  unknown_cost: boolean;
  turns: number | string;
  capped: boolean;
};

async function readSamples(nowIso: string): Promise<ConversationSample[]> {
  const now = new Date(nowIso);
  // Desde el inicio (en Argentina) del día más viejo de la ventana
  const ar = new Date(now.getTime() + AR_OFFSET_MINUTES * 60_000);
  const startAr = Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), ar.getUTCDate() - (DAYS - 1));
  const since = new Date(startAr - AR_OFFSET_MINUTES * 60_000).toISOString();
  const { db, close } = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const rows = (await db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '3s'`);
      // Agrupa por (user_id, label): el id de la charla lo manda el navegador y dos personas
      // podrían repetirlo. Ni user_id ni label salen de la consulta
      return tx.execute(sql`
        select
          min(created_at) as started_at,
          sum(cost_usd)::float8 as cost,
          bool_or(cost_usd is null) as unknown_cost,
          count(*) filter (
            where task = ${ASSISTANT_EVENT_TASK} and prompt_version = ${ASSISTANT_TURN_MARKER}
          )::int as turns,
          coalesce(bool_or(task = ${ASSISTANT_EVENT_TASK} and prompt_version like 'cap:%'), false)
            as capped
        from llm_calls
        where task in (${ASSISTANT_TASK}, ${ASSISTANT_EVENT_TASK})
          and label like 'conv:%'
          and created_at >= ${since}::timestamptz
        group by user_id, label
        having min(created_at) >= ${since}::timestamptz
      `);
    })) as unknown as Row[];
    return rows.map((r) => {
      const turns = Number(r.turns);
      return {
        startedAt: new Date(r.started_at),
        messages: turns > 0 ? turns : null,
        costUsd: r.unknown_cost || r.cost === null ? null : Number(r.cost),
        capped: r.capped,
      };
    });
  } finally {
    await close();
  }
}

// Las Date no sobreviven al caché de Next: se guardan como texto y se arman después
const cachedSamples = unstable_cache(
  async (nowIso: string) =>
    (await readSamples(nowIso)).map((s) => ({ ...s, startedAt: s.startedAt.toISOString() })),
  ["assistant-metrics"],
  { revalidate: 300 },
);

export type AssistantMetricsResult =
  { ok: true; days: AssistantDayMetrics[] } | { ok: false; reason: "no_admin" | "sin_datos" };

export async function getAssistantMetrics(userId: string): Promise<AssistantMetricsResult> {
  if (!(await canCreateInvitations(userId).catch(() => false))) {
    return { ok: false, reason: "no_admin" };
  }
  const now = new Date();
  now.setSeconds(0, 0);
  try {
    const bucket = new Date(now.getTime() - (now.getMinutes() % 5) * 60_000);
    const raw = await cachedSamples(bucket.toISOString());
    const samples: ConversationSample[] = raw.map((s) => ({
      ...s,
      startedAt: new Date(s.startedAt),
    }));
    return {
      ok: true,
      days: aggregateAssistantDays(samples, bucket, {
        days: DAYS,
        offsetMinutes: AR_OFFSET_MINUTES,
      }),
    };
  } catch (e) {
    createLogger({ user_id: userId, task: "assistant_metrics" }).error(
      { err: safeDbError(e) },
      "métricas del asistente: no se pudo leer",
    );
    return { ok: false, reason: "sin_datos" };
  }
}
