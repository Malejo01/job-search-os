import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Áreas de especialidad (C3-3, migración 0054): `profiles.target_specialties` por el camino real. Cada
 * persona lee y escribe solo la suya (profiles_owner), y la base acota la forma. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "d9400000-0000-4000-8000-000000000001";
const B = "d9400000-0000-4000-8000-000000000002";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx as unknown as Sql);
  })) as T;
}

const specialtiesOf = async (userId: string) =>
  (
    await owner<{ target_specialties: unknown }[]>`
      select target_specialties from profiles where user_id = ${userId}`
  )[0]!.target_specialties;

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
  for (const [id, inbound] of [
    [A, "areas0001"],
    [B, "areas0002"],
  ] as const) {
    await owner`insert into users (id, email, name) values (${id}, ${id.slice(-4) + "@areas.test"}, 'Ficticio')
      on conflict (id) do nothing`;
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${inbound}) on conflict (user_id) do nothing`;
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from profiles where user_id in ${owner([A, B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("profiles.target_specialties (C3-3)", () => {
  it("arranca en null: «Todas las áreas»", async () => {
    expect(await specialtiesOf(A)).toBeNull();
  });

  it("la persona guarda sus áreas y solo ve y cambia las suyas", async () => {
    const value = { finanzas_contabilidad: ["impuestos", "sueldos"] };
    await asUser(
      A,
      (tx) =>
        tx`update profiles set target_specialties = ${JSON.stringify(value)}::jsonb where user_id = ${A}`,
    );
    expect(await specialtiesOf(A)).toEqual(value);
    // B no ve las de A ni puede pisarlas
    const seen = await asUser(B, (tx) => tx`select target_specialties from profiles`);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.target_specialties).toBeNull();
    const changed = await asUser(
      B,
      (tx) =>
        tx`update profiles set target_specialties = '{"abogacia":["laboral"]}'::jsonb where user_id = ${A}`,
    );
    expect(changed.count).toBe(0);
    expect(await specialtiesOf(A)).toEqual(value);
  });

  it("la base rechaza lo que no es un objeto o pesa más de 8 KB, y acepta volver a null", async () => {
    for (const bad of ['["impuestos"]', '"impuestos"', "3", "true"]) {
      await expect(
        asUser(A, (tx) =>
          tx.unsafe(
            `update profiles set target_specialties = '${bad}'::jsonb where user_id = '${A}'`,
          ),
        ),
      ).rejects.toThrow(/profiles_target_specialties_shape/);
    }
    const big = JSON.stringify({ finanzas_contabilidad: ["x".repeat(9000)] });
    await expect(
      asUser(
        A,
        (tx) => tx`update profiles set target_specialties = ${big}::jsonb where user_id = ${A}`,
      ),
    ).rejects.toThrow(/profiles_target_specialties_shape/);
    await asUser(A, (tx) => tx`update profiles set target_specialties = null where user_id = ${A}`);
    expect(await specialtiesOf(A)).toBeNull();
  });
});
