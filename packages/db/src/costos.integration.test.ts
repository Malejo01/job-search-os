import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Tablero de gasto de IA (R21-01, rls/0055) por el camino real: la app como jobsearch_app. La función
 * `admin_llm_spend_board()` devuelve solo agregados de `llm_calls` y solo a app_admins. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d2100000-0000-4000-8000-0000000000aa";
const PERSON_ID = "d2100000-0000-4000-8000-000000000001";
const TASK = "tarea_costos_test";
const OTHER_TASK = "otra_tarea_costos_test";
const MAIN = "modelo-principal-test";
const BACKUP = "modelo-respaldo-test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

type Board = {
  today: string;
  days: number;
  daily: { day: string; usd: number; calls: number; failed: number }[];
  by_task: { task: string; usd: number; calls: number; failed: number; fallbacks: number }[];
  by_model: { model: string; usd: number; calls: number; failed: number }[];
  totals: { usd: number; calls: number; failed: number; fallbacks: number; unpriced: number };
};

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function board(days = 30): Promise<Board> {
  const [row] = await asUser(
    ADMIN_ID,
    (tx) => tx<{ b: Board }[]>`select admin_llm_spend_board(${days}::int) as b`,
  );
  return row!.b;
}

async function call(
  task: string,
  model: string,
  opts: { usd: number | null; ok?: boolean; daysAgo?: number },
): Promise<void> {
  await owner`
    insert into llm_calls (user_id, task, model, cost_usd, ok, created_at)
    values (${PERSON_ID}, ${task}, ${model}, ${opts.usd}, ${opts.ok ?? true},
            now() - (${opts.daysAgo ?? 0} || ' days')::interval)`;
}

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of [ADMIN_ID, PERSON_ID]) {
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
  await owner`insert into model_routing (task, provider, model, fallback_model)
    values (${TASK}, 'test', ${MAIN}, ${BACKUP}) on conflict (task) do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from llm_calls where user_id = ${PERSON_ID}`;
    await owner`delete from model_routing where task = ${TASK}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in (${ADMIN_ID}, ${PERSON_ID})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("tablero de gasto de IA (R21-01)", () => {
  it("es solo para app_admins: una cuenta común recibe el error de la barrera", async () => {
    await expect(asUser(PERSON_ID, (tx) => tx`select admin_llm_spend_board(30)`)).rejects.toThrow(
      /admin_llm_spend_board: no autorizado/,
    );
    await expect(
      asUser("d2100000-0000-4000-8000-0000000000ff", (tx) => tx`select admin_llm_spend_board()`),
    ).rejects.toThrow(/no autorizado/);
  });

  it("sin llamadas devuelve bloques vacíos y totales en cero", async () => {
    const b = await board();
    expect(b.days).toBe(30);
    expect(b.daily).toEqual([]);
    expect(b.by_task).toEqual([]);
    expect(b.totals).toEqual({ usd: 0, calls: 0, failed: 0, fallbacks: 0, unpriced: 0 });
  });

  it("agrega por día, tarea y modelo; cuenta fallas, respaldos y llamadas sin tarifa", async () => {
    await call(TASK, MAIN, { usd: 0.25 });
    await call(TASK, MAIN, { usd: 0.25, daysAgo: 1 });
    await call(TASK, BACKUP, { usd: 0.1 });
    await call(TASK, MAIN, { usd: null, ok: false });
    await call(OTHER_TASK, MAIN, { usd: null }); // ok sin tarifa
    // Fuera de la ventana y no-llamadas: no cuentan
    await call(TASK, MAIN, { usd: 9, daysAgo: 45 });
    await call("llm_reserve", MAIN, { usd: 5 });
    await call("budget_alert", MAIN, { usd: 0 });

    const b = await board();
    expect(b.totals.calls).toBe(5);
    expect(b.totals.usd).toBeCloseTo(0.6, 5);
    expect(b.totals.failed).toBe(1);
    expect(b.totals.fallbacks).toBe(1);
    expect(b.totals.unpriced).toBe(1);

    const task = b.by_task.find((t) => t.task === TASK)!;
    expect(task).toMatchObject({ calls: 4, failed: 1, fallbacks: 1 });
    expect(task.usd).toBeCloseTo(0.6, 5);
    // Una tarea sin fila en model_routing no marca respaldos
    expect(b.by_task.find((t) => t.task === OTHER_TASK)).toMatchObject({ calls: 1, fallbacks: 0 });
    expect(b.by_task.map((t) => t.task)).not.toContain("llm_reserve");

    expect(b.by_model.find((m) => m.model === BACKUP)).toMatchObject({ calls: 1, failed: 0 });
    expect(b.by_model.find((m) => m.model === MAIN)!.calls).toBe(4);

    expect(b.daily).toHaveLength(2);
    expect(b.daily.at(-1)!.day).toBe(b.today);
    expect(b.daily.at(-1)!.calls).toBe(4);
  });

  it("la ventana se acota a p_days y a 1 y 90 como extremos", async () => {
    expect((await board(1)).totals.calls).toBe(4);
    expect((await board(0)).days).toBe(1);
    expect((await board(500)).days).toBe(90);
  });

  it("solo salen números y claves de tarea o modelo: ni ids ni emails de personas", async () => {
    const text = JSON.stringify(await board());
    expect(text).not.toContain(PERSON_ID);
    expect(text).not.toContain("@");
  });
});
