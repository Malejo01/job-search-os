import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Migraciones 0020 y 0021 (ronda 45, ADR-016): `profiles.target_roles` / `max_target_roles` y
 * `jobs.matched_role` (0020, de esquema) y el backfill `target_roles = ARRAY[target_role]` (0021,
 * de datos). Se aplican todas las migraciones y, para probar el backfill, el test deja los perfiles
 * en el estado "entre la 0020 y la 0021" (lista vacía) y corre el SQL de la 0021 statement por
 * statement, como el migrador. Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL;
 * local: Testcontainer).
 */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const backfillSql = readFileSync(
  join(PKG_ROOT, "drizzle", "0021_target_roles_backfill.sql"),
  "utf8",
);

const CON_ROL = "a5000000-0000-4000-8000-000000000001";
const SIN_ROL = "a5000000-0000-4000-8000-000000000002";
const YA_ELIGIO = "a5000000-0000-4000-8000-000000000003";
const USERS = [CON_ROL, SIN_ROL, YA_ELIGIO];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function runBackfill() {
  for (const statement of backfillSql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

async function rolesOf(userId: string) {
  const [row] = await owner<
    { target_role: string | null; target_roles: string[]; max_target_roles: number | null }[]
  >`select target_role, target_roles, max_target_roles from profiles where user_id = ${userId}`;
  return row!;
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
  owner = postgres(ownerUrl, { max: 2 });
  await owner`delete from profiles where user_id = any(${USERS})`;
  // Estado "entre la 0020 y la 0021": target_roles con su default ('{}'), sin tocar target_role
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address, target_role)
    values
      (${CON_ROL}, 'Test', 'AR', 'u_a5_1@ingest.test', 'qa'),
      (${SIN_ROL}, 'Test', 'AR', 'u_a5_2@ingest.test', null)`;
  await owner`insert into profiles (user_id, display_name, location_country, inbound_address, target_role, target_roles)
    values (${YA_ELIGIO}, 'Test', 'AR', 'u_a5_3@ingest.test', 'qa', ${["ux_ui", "backend"]}::text[])`;
}, 180_000);

afterAll(async () => {
  if (owner) await owner`delete from profiles where user_id = any(${USERS})`;
  await owner?.end();
  await container?.stop();
});

describe("0020: columnas nuevas", () => {
  it("target_roles es text[] not null con default '{}', max_target_roles admite null", async () => {
    const cols = await owner<{ column_name: string; is_nullable: string; data_type: string }[]>`
      select column_name, is_nullable, data_type from information_schema.columns
      where (table_name = 'profiles' and column_name in ('target_roles', 'max_target_roles'))
         or (table_name = 'jobs' and column_name = 'matched_role')
      order by table_name, column_name`;
    expect(cols).toEqual([
      { column_name: "matched_role", is_nullable: "YES", data_type: "text" },
      { column_name: "max_target_roles", is_nullable: "YES", data_type: "integer" },
      { column_name: "target_roles", is_nullable: "NO", data_type: "ARRAY" },
    ]);
    expect((await rolesOf(SIN_ROL)).target_roles).toEqual([]);
    expect((await rolesOf(SIN_ROL)).max_target_roles).toBeNull();
  });
});

describe("0021: backfill de target_roles", () => {
  it("un perfil con target_role queda con {rol}; sin rol queda {}; no pisa lo ya elegido", async () => {
    expect((await rolesOf(CON_ROL)).target_roles).toEqual([]);
    await runBackfill();
    expect((await rolesOf(CON_ROL)).target_roles).toEqual(["qa"]);
    expect((await rolesOf(SIN_ROL)).target_roles).toEqual([]);
    expect((await rolesOf(YA_ELIGIO)).target_roles).toEqual(["ux_ui", "backend"]);
  });

  it("es idempotente: correrla de nuevo no duplica ni cambia nada", async () => {
    await runBackfill();
    await runBackfill();
    expect((await rolesOf(CON_ROL)).target_roles).toEqual(["qa"]);
    expect((await rolesOf(SIN_ROL)).target_roles).toEqual([]);
    expect((await rolesOf(YA_ELIGIO)).target_roles).toEqual(["ux_ui", "backend"]);
  });

  it("no toca target_role", async () => {
    expect((await rolesOf(CON_ROL)).target_role).toBe("qa");
    expect((await rolesOf(SIN_ROL)).target_role).toBeNull();
  });
});
