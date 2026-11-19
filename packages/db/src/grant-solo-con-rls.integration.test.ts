import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Los permisos de la app se dan solo a tablas con RLS activo. Una tabla creada sin RLS no queda accesible
 * para el rol de la app después de aplicar las RLS, y las que ya tenían permisos los conservan. Datos inventados.
 */
const SIN_RLS = "s3_prueba_sin_rls";
const CON_RLS = "s3_prueba_con_rls";

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let ownerUrl: string;

async function appCan(table: string, privilege = "SELECT"): Promise<boolean> {
  const [row] = await owner<{ ok: boolean }[]>`
    select has_table_privilege('jobsearch_app', ${"public." + table}, ${privilege}) as ok`;
  return row!.ok;
}

beforeAll(async () => {
  ownerUrl = process.env.DATABASE_URL ?? "";
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
  await owner.unsafe(`create table public.${SIN_RLS} (id int primary key)`);
  await owner.unsafe(`create table public.${CON_RLS} (id int primary key)`);
  await owner.unsafe(`alter table public.${CON_RLS} enable row level security`);
  await owner.unsafe(`alter table public.${CON_RLS} force row level security`);
  await owner.unsafe(`create policy s3_prueba_read on public.${CON_RLS} for select using (true)`);
  await applyMigrations(ownerUrl, { log: () => {} });
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner.unsafe(`drop table if exists public.${SIN_RLS}, public.${CON_RLS}`).catch(() => undefined);
  }
  await owner?.end();
  await container?.stop();
});

describe("permisos de la app solo con RLS", () => {
  it("una tabla creada sin RLS no queda accesible para el rol de la app", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await appCan(SIN_RLS, p), p).toBe(false);
    }
  });

  it("una tabla con RLS activo recibe los permisos", async () => {
    for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      expect(await appCan(CON_RLS, p), p).toBe(true);
    }
  });

  it("las tablas existentes conservan sus permisos", async () => {
    for (const table of ["jobs", "profiles", "users", "evaluations"]) {
      expect(await appCan(table), table).toBe(true);
    }
  });

  it("al activar RLS en la tabla, el siguiente db:migrate le da los permisos", async () => {
    await owner.unsafe(`alter table public.${SIN_RLS} enable row level security`);
    await owner.unsafe(`create policy s3_prueba_read on public.${SIN_RLS} for select using (true)`);
    await applyMigrations(ownerUrl, { log: () => {} });

    expect(await appCan(SIN_RLS)).toBe(true);
  }, 120_000);
});
