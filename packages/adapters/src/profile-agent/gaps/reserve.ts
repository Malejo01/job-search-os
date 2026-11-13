import { schema as s, type Db } from "@job-search-os/db";
import {
  CV_CHAT_TURN_RESERVE_USD,
  CV_CHAT_WRITE_RESERVE_USD,
  PROFILE_AGENT_READ_RESERVE_USD,
  cvChatStartCapReason,
  profileAgentCapReason,
  type ProfileAgentCap,
} from "@job-search-os/pipeline";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  CV_RESERVE_LOCK_NAMESPACE,
  CV_RESERVE_TASK,
  CV_RESERVE_TTL_MS,
  CV_START_TASK,
} from "../../cv-chat/reserve";

/**
 * Medidas y reservas de la etapa de huecos (ADR-034 §5 y §6). Mismo esquema que el chat de CV
 * (`cv-chat/reserve.ts`, S-1): una transacción corta con `pg_advisory_xact_lock` por persona mide, decide y
 * anota la reserva; la llamada al modelo va afuera; otra transacción corta borra la reserva. Se reusan las
 * filas `cv_reserve` y `cv_start` y el mismo lock, así el chat de CV y el agente se cuentan entre sí.
 *
 * Diferencias con el chat (decididas en el ADR):
 * - los turnos de la charla son las llamadas a `cv_interview` con su `label` (`cv:<flowId>`): el navegador no
 *   los reporta;
 * - el gasto suma `COALESCE(cost_usd, estimado del paso)` de TODAS las filas de las tareas del agente
 *   (`extract_cv_profile`, `cv_interview`, `cv_write`): una llamada fallida llega con `cost_usd` null (O1);
 *   un costo negativo o inválido también cae al estimado, nunca resta;
 * - los topes de USD rigen para todos, también para `ADMIN_EMAILS` y `ASSISTANT_TESTER_EMAILS` (O2): acá no
 *   hay ningún parámetro de exención.
 */
export const GAP_INTERVIEW_TASK = "cv_interview";
const AGENT_TASKS = ["extract_cv_profile", "cv_interview", "cv_write"] as const;
const MICRO_USD = 1_000_000;

/** Estimado por tarea de las llamadas sin costo conocido: el máximo del paso, el mismo de las reservas. */
const STEP_ESTIMATE_USD: Record<(typeof AGENT_TASKS)[number], number> = {
  extract_cv_profile: PROFILE_AGENT_READ_RESERVE_USD,
  cv_interview: CV_CHAT_TURN_RESERVE_USD,
  cv_write: CV_CHAT_WRITE_RESERVE_USD,
};

export type GapMeasures = {
  /** Llamadas a `cv_interview` de esta charla, también las que fallaron. */
  gapTurns: number;
  /** Gasto de esta charla: real o estimado, más lo reservado. */
  flowCostUsd: number;
  /** Gasto de la persona en 24 h, de todas sus charlas. */
  userSpendTodayUsd: number;
  /** Gasto global del agente en 24 h. */
  dailySpendUsd: number;
  /** Charlas que la persona empezó en 24 h (filas `cv_start`, las del chat de CV también). */
  startsToday: number;
};

/** Un intento que llegó al proveedor cuenta aunque haya fallado; solo `provider_unavailable` no. */
const attempted = (c: typeof s.llmCalls) => sql`${c.error} is distinct from 'provider_unavailable'`;

/**
 * Espejo en SQL de `profileAgentRowCostUsd`: el costo real si es válido (0 o más, finito); si no, el
 * estimado de la tarea. Las filas de otras tareas (marcadores, reservas) valen 0 acá.
 */
export const gapBilledUsd = (c: typeof s.llmCalls) =>
  sql`case when ${c.task} in ('extract_cv_profile', 'cv_interview', 'cv_write') and ${attempted(c)} then (case when ${c.costUsd}::float8 between 0 and 'Infinity'::float8 then ${c.costUsd}::float8 when ${c.task} = 'extract_cv_profile' then ${STEP_ESTIMATE_USD.extract_cv_profile}::float8 when ${c.task} = 'cv_write' then ${STEP_ESTIMATE_USD.cv_write}::float8 else ${STEP_ESTIMATE_USD.cv_interview}::float8 end) else 0 end`;

export async function measureGaps(
  q: Pick<Db, "select">,
  input: { userId: string; label: string; daySince: Date; now: Date },
): Promise<GapMeasures> {
  const c = s.llmCalls;
  const [flow] = await q
    .select({
      turns: sql<number>`count(*) filter (where ${c.task} = ${GAP_INTERVIEW_TASK} and ${attempted(c)})::int`,
      usd: sql<number>`coalesce(sum(${gapBilledUsd(c)}), 0)::float8`,
    })
    .from(c)
    .where(and(eq(c.userId, input.userId), eq(c.label, input.label)));
  const [mine] = await q
    .select({
      usd: sql<number>`coalesce(sum(${gapBilledUsd(c)}), 0)::float8`,
      starts: sql<number>`count(*) filter (where ${c.task} = ${CV_START_TASK})::int`,
    })
    .from(c)
    .where(and(eq(c.userId, input.userId), gte(c.createdAt, input.daySince)));
  const [day] = await q
    .select({ usd: sql<number>`coalesce(sum(${gapBilledUsd(c)}), 0)::float8` })
    .from(c)
    .where(and(inArray(c.task, [...AGENT_TASKS]), gte(c.createdAt, input.daySince)));
  const live = await q
    .select({ userId: c.userId, label: c.label, micro: c.tokensOut, step: c.model })
    .from(c)
    .where(
      and(
        eq(c.task, CV_RESERVE_TASK),
        gte(c.createdAt, new Date(input.now.getTime() - CV_RESERVE_TTL_MS)),
      ),
    );
  const usd = (rows: typeof live) => rows.reduce((t, r) => t + (r.micro ?? 0), 0) / MICRO_USD;
  const mineLive = live.filter((r) => r.userId === input.userId);
  return {
    // O-A: las reservas vivas de turnos de esta charla cuentan, así `answer` en paralelo no pasa de 20
    gapTurns:
      (flow?.turns ?? 0) +
      mineLive.filter((r) => r.label === input.label && r.step === "interview").length,
    flowCostUsd: (flow?.usd ?? 0) + usd(mineLive.filter((r) => r.label === input.label)),
    userSpendTodayUsd: (mine?.usd ?? 0) + usd(mineLive),
    dailySpendUsd: (day?.usd ?? 0) + usd(live),
    startsToday: mine?.starts ?? 0,
  };
}

/** Por qué no se hace el paso: un tope del agente o el de charlas nuevas por día (5, el del chat de CV). */
export type GapReject = ProfileAgentCap | "inicios";

/** Decisión pura sobre las medidas. Los topes de USD valen para todos: no recibe ninguna exención. */
export function decideGapStep(
  step: "turn" | "check" | "start",
  m: GapMeasures,
  dailyCapUsd: number,
): GapReject | null {
  if (step === "start") {
    const starts = cvChatStartCapReason(m.startsToday);
    if (starts !== null) return starts;
  }
  return profileAgentCapReason({
    // en la etapa de huecos solo rigen turnos, charla, persona y global; la lectura no se mide acá
    stage: "gaps",
    exempt: false,
    readsThisMonth: 0,
    readsPerMonth: 1,
    readsToday: 0,
    // `check` y `start` no llaman al modelo: el tope de turnos solo frena nuevas llamadas
    gapTurns: step === "turn" ? m.gapTurns : 0,
    flowCostUsd: m.flowCostUsd,
    userSpendTodayUsd: m.userSpendTodayUsd,
    dailySpendUsd: m.dailySpendUsd,
    dailyCapUsd,
  });
}

export type GapReservation =
  | { ok: true; reservationId: string | null; measures: GapMeasures }
  | { ok: false; reject: GapReject; measures: GapMeasures };

/**
 * Transacción corta con lock de la persona. `turn` reserva el máximo de un turno antes de llamar al modelo;
 * `start` anota una charla nueva (fila `cv_start`, costo 0) y cuenta en los 5 por día **aunque el pedido no
 * traiga ticket o traiga uno inválido** (O3): el ticket solo protege los contadores de una charla, no abre
 * charlas gratis; `check` solo mide y decide (acciones sin llamada al modelo).
 */
export async function reserveGapStep(
  db: Db,
  input: {
    userId: string;
    label: string;
    step: "turn" | "check" | "start";
    now: Date;
    daySince: Date;
    dailyCapUsd: number;
  },
): Promise<GapReservation> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.userId}, ${CV_RESERVE_LOCK_NAMESPACE}))`,
    );
    const measures = await measureGaps(tx, input);
    const reject = decideGapStep(input.step, measures, input.dailyCapUsd);
    if (reject !== null) return { ok: false as const, reject, measures };
    if (input.step === "check") return { ok: true as const, reservationId: null, measures };
    const base = {
      userId: input.userId,
      jobId: null,
      tokensIn: null,
      tokensReasoning: null,
      latencyMs: 0,
      label: input.label,
      ok: true,
      error: null,
    };
    if (input.step === "start") {
      await tx.insert(s.llmCalls).values({
        ...base,
        task: CV_START_TASK,
        model: "none",
        promptVersion: `${CV_START_TASK}@v1`,
        tokensOut: 0,
        costUsd: 0,
      });
      return { ok: true as const, reservationId: null, measures };
    }
    const [row] = await tx
      .insert(s.llmCalls)
      .values({
        ...base,
        task: CV_RESERVE_TASK,
        model: "interview",
        promptVersion: `${CV_RESERVE_TASK}@v1`,
        tokensOut: Math.max(0, Math.round(CV_CHAT_TURN_RESERVE_USD * MICRO_USD)),
        costUsd: null,
      })
      .returning({ id: s.llmCalls.id });
    return { ok: true as const, reservationId: row?.id ?? null, measures };
  });
}
