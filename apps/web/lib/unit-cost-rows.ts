import type { UnitCostInput } from "@job-search-os/pipeline";
import { sql } from "drizzle-orm";

/**
 * Filas agregadas para el costo por unidad (tablero de costos). Solo agregados: gasto y llamadas por
 * tarea, cuántas charlas del coach distintas hubo y el gasto total de cada persona SIN su id (la
 * consulta ni siquiera lo selecciona). Sin I/O propio: recibe la conexión, para probarla con datos
 * ficticios en integración (`packages/adapters/src/llm/unit-cost-rows.integration.test.ts`).
 *
 * Sale de `llm_calls`: solo `cost_usd` real (una llamada sin costo cuenta 0, igual que en el tablero),
 * sin las corridas de evals (`task = eval:*`) ni las filas que no son llamadas al modelo (reservas,
 * marcas). Las cuentas de prueba (`users.is_test`) no cuentan como personas.
 */
export const UNIT_COST_WINDOW_DAYS = 30;

/** Espejo de `NOT_MODEL_CALLS` de adapters/llm/spend.ts (filas con costo 0 que no son llamadas). */
const NOT_MODEL_CALLS = [
  "cv_reserve",
  "llm_reserve",
  "cv_start",
  "budget_alert",
  "assistant_event",
  "profile_read",
];
const COACH_TASKS = ["cv_coach_turn", "cv_interview", "cv_write"];

type Executor = { execute: (q: ReturnType<typeof sql>) => PromiseLike<unknown> };
type TaskRaw = {
  task: string;
  spend: number | string;
  calls: number | string;
  ok_calls: number | string;
};
type ChatsRaw = { chats: number | string };
type PersonRaw = { usd: number | string };

const list = (xs: readonly string[]) =>
  sql.join(
    xs.map((x) => sql`${x}`),
    sql`, `,
  );

export async function readUnitCostRows(db: Executor, now: Date): Promise<UnitCostInput> {
  const since = new Date(now.getTime() - UNIT_COST_WINDOW_DAYS * 86_400_000).toISOString();
  const real = sql`created_at >= ${since}::timestamptz and created_at <= ${now.toISOString()}::timestamptz
    and task not like 'eval:%' and task not in (${list(NOT_MODEL_CALLS)})`;

  const tasks = (await db.execute(sql`
    select task,
           coalesce(sum(case when cost_usd between 0 and 'Infinity'::float8 then cost_usd end), 0) as spend,
           count(*) as calls,
           count(*) filter (where ok) as ok_calls
    from llm_calls
    where ${real}
    group by task
  `)) as unknown as TaskRaw[];

  const chats = (await db.execute(sql`
    select count(distinct label) as chats
    from llm_calls
    where ${real} and task in (${list(COACH_TASKS)}) and label is not null
  `)) as unknown as ChatsRaw[];

  // Un número por persona con gasto; el id no sale de la base
  const people = (await db.execute(sql`
    select sum(case when cost_usd between 0 and 'Infinity'::float8 then cost_usd end) as usd
    from llm_calls c
    where ${real} and c.user_id is not null
      and not exists (select 1 from users u where u.id = c.user_id and u.is_test)
    group by c.user_id
    having coalesce(sum(case when cost_usd between 0 and 'Infinity'::float8 then cost_usd end), 0) > 0
  `)) as unknown as PersonRaw[];

  return {
    tasks: tasks.map((t) => ({
      task: t.task,
      spendUsd: Number(t.spend),
      calls: Number(t.calls),
      okCalls: Number(t.ok_calls),
    })),
    coachChats: Number(chats[0]?.chats ?? 0),
    personSpendUsd: people.map((p) => Number(p.usd)),
  };
}
