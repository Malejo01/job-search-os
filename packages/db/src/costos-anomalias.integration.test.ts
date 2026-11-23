import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Anomalías de gasto de IA (R21-05, rls/0056) por el camino real: la app como jobsearch_app. La función
 * `admin_llm_spend_anomalies()` devuelve por tarea el gasto de 24 h y el de los 7 días anteriores, solo
 * a app_admins. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d3100000-0000-4000-8000-0000000000aa";
const PERSON_ID = "d3100000-0000-4000-8000-000000000001";
const T_SPIKE = "tarea_pico_test";
const T_NORMAL = "tarea_normal_test";
const T_NEW = "tarea_nueva_test";
const T_OLD = "tarea_vieja_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

type Row = { task: string; usd_24h: number; usd_prev_7d: number };

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function anomalies(): Promise<Row[]> {
  const [row] = await asUser(
    ADMIN_ID,
    (tx) => tx<{ a: Row[] }[]>`select admin_llm_spend_anomalies() as a`,
  );
  return row!.a;
}

async function call(task: string, usd: number | null, hoursAgo: number): Promise<void> {
  await owner`
    insert into llm_calls (user_id, task, model, cost_usd, ok, created_at)
    values (${PERSON_ID}, ${task}, 'modelo-test', ${usd}, true,
            now() - (${hoursAgo} || ' hours')::interval)`;
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
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from llm_calls where user_id = ${PERSON_ID}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in (${ADMIN_ID}, ${PERSON_ID})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("anomalías de gasto de IA (R21-05)", () => {
  it("es solo para app_admins: una cuenta común recibe el error de la barrera", async () => {
    await expect(asUser(PERSON_ID, (tx) => tx`select admin_llm_spend_anomalies()`)).rejects.toThrow(
      /admin_llm_spend_anomalies: no autorizado/,
    );
  });

  it("sin llamadas devuelve una lista vacía", async () => {
    expect(await anomalies()).toEqual([]);
  });

  it("separa las últimas 24 h de los 7 días anteriores, por tarea", async () => {
    // Pico: 1,00 hoy contra 2,10 en los 7 días anteriores (promedio 0,30)
    await call(T_SPIKE, 0.6, 2);
    await call(T_SPIKE, 0.4, 20);
    await call(T_SPIKE, 1.0, 30);
    await call(T_SPIKE, 1.1, 24 * 6);
    // Normal: 0,30 hoy contra 2,10
    await call(T_NORMAL, 0.3, 3);
    await call(T_NORMAL, 2.1, 50);
    // Nueva: gasta hoy, sin historia
    await call(T_NEW, 0.5, 1);
    // Sin gasto en 24 h: no aparece; fuera de los 8 días: no cuenta; reservas excluidas
    await call(T_OLD, 5, 24 * 3);
    await call(T_SPIKE, 50, 24 * 12);
    await call("llm_reserve", 5, 1);
    await call(T_NEW, null, 1); // sin tarifa: no suma

    const rows = await anomalies();
    const by = Object.fromEntries(rows.map((r) => [r.task, r]));
    expect(by[T_SPIKE]!.usd_24h).toBeCloseTo(1.0, 5);
    expect(by[T_SPIKE]!.usd_prev_7d).toBeCloseTo(2.1, 5);
    expect(by[T_NORMAL]!.usd_24h).toBeCloseTo(0.3, 5);
    expect(by[T_NORMAL]!.usd_prev_7d).toBeCloseTo(2.1, 5);
    expect(by[T_NEW]).toMatchObject({ usd_24h: 0.5, usd_prev_7d: 0 });
    expect(by[T_OLD]).toBeUndefined();
    expect(by["llm_reserve"]).toBeUndefined();
    expect(rows.map((r) => r.task)).toEqual([T_SPIKE, T_NEW, T_NORMAL]);
  });

  it("solo salen tareas y números: ni ids ni emails de personas", async () => {
    const text = JSON.stringify(await anomalies());
    expect(text).not.toContain(PERSON_ID);
    expect(text).not.toContain("@");
  });
});
