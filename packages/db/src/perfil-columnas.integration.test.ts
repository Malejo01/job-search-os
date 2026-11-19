import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Columnas del perfil y cola de evaluación, por el camino real: como jobsearch_app en una transacción
 * con app.user_id, igual que withUser. Datos inventados.
 */
const A = "a2600000-0000-4000-8000-000000000001";
const B = "b2600000-0000-4000-8000-000000000002";
const ADDRESS_A = "u_abcdefghijklmnopqrst@ingest.test";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let jobA: string;
let jobB: string;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx);
  })) as T;
}

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
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
  app = postgres(u.toString(), { max: 2, prepare: false });
  await owner`insert into users (id, email) values
    (${A}, 'perfil-a@example.com'), (${B}, 'perfil-b@example.com')`;
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address) values
    (${A}, 'Persona A', 'AR', ${ADDRESS_A}),
    (${B}, 'Persona B', 'AR', 'u_bcdefghijklmnopqrstu@ingest.test')`;
  [{ id: jobA }] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${A}, 'Empresa A', 'Puesto A', 'puesto a') returning id` as unknown as [{ id: string }];
  [{ id: jobB }] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${B}, 'Empresa B', 'Puesto B', 'puesto b') returning id` as unknown as [{ id: string }];
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from job_queue where user_id in (${A}, ${B})`;
    await owner`delete from jobs where user_id in (${A}, ${B})`;
    await owner`delete from profiles where user_id in (${A}, ${B})`;
    await owner`delete from users where id in (${A}, ${B})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("topes del perfil", () => {
  it("la app no puede cambiar el tope diario de evaluaciones", async () => {
    await expect(
      asUser(A, (tx) => tx`update profiles set pool_daily_eval_limit = 1000 where user_id = ${A}`),
    ).rejects.toThrow(/profiles_plan_guard/);
    const [row] = await owner`select pool_daily_eval_limit from profiles where user_id = ${A}`;
    expect(row!.pool_daily_eval_limit).toBeNull();
  });

  it("la app no puede cambiar el tope de puestos", async () => {
    await expect(
      asUser(A, (tx) => tx`update profiles set max_target_roles = 50 where user_id = ${A}`),
    ).rejects.toThrow(/profiles_plan_guard/);
  });

  it("la app sigue pudiendo editar el resto del perfil", async () => {
    await asUser(A, (tx) => tx`update profiles set display_name = 'Nombre nuevo' where user_id = ${A}`);
    const [row] = await owner`select display_name from profiles where user_id = ${A}`;
    expect(row!.display_name).toBe("Nombre nuevo");
  });

  it("el dueño sigue pudiendo fijar los topes", async () => {
    await owner`update profiles set pool_daily_eval_limit = 30 where user_id = ${B}`;
    const [row] = await owner`select pool_daily_eval_limit from profiles where user_id = ${B}`;
    expect(row!.pool_daily_eval_limit).toBe(30);
    await owner`update profiles set pool_daily_eval_limit = null where user_id = ${B}`;
  });
});

describe("dirección de ingesta", () => {
  it.each([
    "elegida@ingest.test",
    "u_aaaaaaaa@ingest.test",
    "pool-backend@ingest.test",
    "u_ABCDEFGHIJKLMNOPQRST@ingest.test",
  ])("la app no puede poner %s", async (address) => {
    await expect(
      asUser(A, (tx) => tx`update profiles set inbound_address = ${address} where user_id = ${A}`),
    ).rejects.toThrow(/profiles_plan_guard/);
  });

  it("la app puede rotarla a una dirección aleatoria", async () => {
    const next = "u_zyxwvutsrqponmlkjihg@ingest.test";
    await asUser(A, (tx) => tx`update profiles set inbound_address = ${next} where user_id = ${A}`);
    const [row] = await owner`select inbound_address from profiles where user_id = ${A}`;
    expect(row!.inbound_address).toBe(next);
  });
});

describe("cola de evaluación", () => {
  const payload = (jobId: string) => ({ jobId });

  it("la app puede encolar un aviso propio", async () => {
    await asUser(
      A,
      (tx) => tx`insert into job_queue (queue, user_id, payload)
                 values ('evaluate_job', ${A}, ${tx.json(payload(jobA))})`,
    );
    const rows = await owner`select 1 from job_queue where user_id = ${A}`;
    expect(rows).toHaveLength(1);
  });

  it("la app no puede encolar un aviso de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into job_queue (queue, user_id, payload)
                   values ('evaluate_job', ${A}, ${tx.json(payload(jobB))})`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("no puede mover una fila propia hacia un aviso de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`update job_queue set payload = ${tx.json(payload(jobB))} where user_id = ${A}`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});
