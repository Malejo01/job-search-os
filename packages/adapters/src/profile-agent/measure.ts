import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  PROFILE_AGENT_READ_RESERVE_USD,
} from "@job-search-os/pipeline";
import { and, gte, inArray, sql } from "drizzle-orm";

/**
 * Una sola medición del gasto del agente de perfil (ADR-034 §6, O1). La usan la lectura, los huecos y el
 * cierre: antes cada etapa tenía la suya y no coincidían (una dejaba pasar un costo negativo, otra solo
 * estimaba las filas con `ok = false`).
 *
 * Regla: una llamada que llegó al proveedor cuenta aunque haya fallado. Si trae un costo válido (0 o más,
 * finito) vale ese; si llega con `cost_usd` null (las fallidas) o inválido vale el estimado de su tarea (el
 * máximo del paso, el mismo de las reservas). Solo `provider_unavailable` (nunca salió) vale 0. Es el espejo
 * en SQL de `profileAgentRowCostUsd` (pipeline).
 */
export const PROFILE_AGENT_SPEND_TASKS = [
  "extract_cv_profile",
  "cv_interview",
  "cv_write",
] as const;

const MICRO_USD = 1_000_000;

/** Un intento que llegó al proveedor cuenta aunque haya fallado; solo `provider_unavailable` no. */
export const profileAgentAttempted = (c: typeof s.llmCalls) =>
  sql`${c.error} is distinct from 'provider_unavailable'`;

/** Costo de una fila en USD: real si es válido, estimado del paso si no; 0 para otras tareas. */
export const profileAgentBilledUsd = (c: typeof s.llmCalls) =>
  sql`case when ${c.task} in ('extract_cv_profile', 'cv_interview', 'cv_write') and ${profileAgentAttempted(c)} then (case when ${c.costUsd}::float8 between 0 and 'Infinity'::float8 then ${c.costUsd}::float8 when ${c.task} = 'extract_cv_profile' then ${PROFILE_AGENT_READ_RESERVE_USD}::float8 when ${c.task} = 'cv_write' then ${CV_CHAT_WRITE_RESERVE_USD}::float8 else ${CV_CHAT_TURN_RESERVE_USD}::float8 end) else 0 end`;

export type ProfileAgentSpend = {
  /** Gasto de la persona desde `daySince`, de todas sus charlas. */
  userUsd: number;
  /** Gasto global del agente desde `daySince`. */
  dailyUsd: number;
};

/** Gasto de la persona y global del agente desde `daySince`, sin reservas vivas (las suma quien llama). */
export async function measureProfileAgentSpend(
  q: Pick<Db, "select">,
  input: { userId: string; daySince: Date },
): Promise<ProfileAgentSpend> {
  const c = s.llmCalls;
  const [row] = await q
    .select({
      all: sql<number>`coalesce(sum(${profileAgentBilledUsd(c)}), 0)::float8`,
      mine: sql<number>`coalesce(sum(${profileAgentBilledUsd(c)}) filter (where ${c.userId} = ${input.userId}), 0)::float8`,
    })
    .from(c)
    .where(and(inArray(c.task, [...PROFILE_AGENT_SPEND_TASKS]), gte(c.createdAt, input.daySince)));
  return { userUsd: row?.mine ?? 0, dailyUsd: row?.all ?? 0 };
}

/** USD que anotan las filas de reserva (`tokens_out` en micro-USD). */
export const reservedUsd = (rows: readonly { micro: number | null }[]): number =>
  rows.reduce((t, r) => t + (r.micro ?? 0), 0) / MICRO_USD;
