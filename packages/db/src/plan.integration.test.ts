import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Plan de la beta paga (C-11b, rls/0010_plan.sql) por el camino real: la app como jobsearch_app
 * puede editar su perfil, pero no su plan ni su vencimiento. El dueño sí. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const USER = "d9200000-0000-4000-8000-000000000001";
const NEW_USER = "d9200000-0000-4000-8000-000000000002";
const BOTH = [USER, NEW_USER];
const GUARD = /profiles_plan_guard: el plan lo asigna el dueño/;
const SET_NAME = "update profiles set display_name = $2 where user_id = $1";
const SET_PLAN = "update profiles set plan = 'fundador' where user_id = $1";
const SET_UNTIL = "update profiles set plan_until = now() where user_id = $1";
const INSERT_PAID = `insert into profiles (user_id, display_name, location_country, inbound_address, plan)
  values ($1, 'Ficticio', 'AR', 'plan0002', 'lista')`;

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

/** Una sentencia de la app con app.user_id puesto (lo que hace withUser en la web). */
async function asUser(userId: string, run: (tx: Sql) => Promise<unknown>): Promise<void> {
  await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    await run(tx as unknown as Sql);
  });
}

async function planOf(userId: string): Promise<string | undefined> {
  const rows = await owner.unsafe("select plan from profiles where user_id = $1", [userId]);
  return rows[0]?.plan as string | undefined;
}

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
    const pg = new PostgreSqlContainer("pgvector/pgvector:pg16").withDatabase("jobsearch");
    container = await pg.withUsername("postgres").withPassword("postgres").start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 2, prepare: false });
  for (const id of BOTH) {
    const email = `${id.slice(-4)}@ejemplo.test`;
    await owner`insert into users (id, email, name) values (${id}, ${email}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
    values (${USER}, 'Ficticio', 'AR', 'plan0001') on conflict (user_id) do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from profiles where user_id in ${owner(BOTH)}`;
    await owner`delete from users where id in ${owner(BOTH)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("plan del perfil (C-11b)", () => {
  it("un perfil nuevo arranca en gratis y sin vencimiento", async () => {
    const rows = await owner`select plan, plan_until from profiles where user_id = ${USER}`;
    expect(rows[0]).toEqual({ plan: "gratis", plan_until: null });
  });

  it("la app edita su perfil, pero no se sube el plan ni estira el vencimiento", async () => {
    await asUser(USER, (tx) => tx.unsafe(SET_NAME, [USER, "Otro"]));
    await expect(asUser(USER, (tx) => tx.unsafe(SET_PLAN, [USER]))).rejects.toThrow(GUARD);
    await expect(asUser(USER, (tx) => tx.unsafe(SET_UNTIL, [USER]))).rejects.toThrow(GUARD);
    expect(await planOf(USER)).toBe("gratis");
  });

  it("la app no puede crear un perfil con plan pago", async () => {
    const insert = asUser(NEW_USER, (tx) => tx.unsafe(INSERT_PAID, [NEW_USER]));
    await expect(insert).rejects.toThrow(GUARD);
    expect(await planOf(NEW_USER)).toBeUndefined();
  });

  it("el dueño asigna el plan, y el check rechaza una clave que no existe", async () => {
    await owner`update profiles set plan = 'pase_3_meses', plan_until = now() + interval '90 days'
      where user_id = ${USER}`;
    expect(await planOf(USER)).toBe("pase_3_meses");
    const unknown = owner`update profiles set plan = 'premium' where user_id = ${USER}`;
    await expect(unknown).rejects.toThrow(/profiles_plan_check/);
    // Con el plan ya asignado, la app sigue pudiendo editar el resto de su perfil
    await asUser(USER, (tx) => tx.unsafe(SET_NAME, [USER, "Tercero"]));
  });
});
