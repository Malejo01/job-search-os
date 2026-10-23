import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Boards de ATS del pool (ronda 47, migración 0024 y rls/0005): sin policy, la app no ve filas;
 * el dueño (el cron con la conexión de servicio) inserta y lee. Datos inventados.
 */
const USER = "11111111-1111-1111-1111-111111111111";
const APP_PASSWORD = "jobsearch_app_test";
const TOKEN = "empresa-ficticia-ats-test";

let container: StartedPostgreSqlContainer | null = null;
let ownerUrl: string;
let appUrl: string;
let owner: Sql;

async function asApp<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(appUrl, { max: 1, prepare: false });
  try {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.user_id = '${USER}'`);
      return fn(tx as unknown as Sql);
    })) as T;
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
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
  appUrl = u.toString();
  await owner`delete from ats_boards where token = ${TOKEN}`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from ats_boards where token = ${TOKEN}`;
    await owner.end();
  }
  await container?.stop();
});

describe("ats_boards", () => {
  it("el dueño inserta y lee, con los defaults", async () => {
    await owner`insert into ats_boards (provider, token, company_name)
                values ('greenhouse', ${TOKEN}, 'Empresa Ficticia 1')`;
    const [row] = await owner`select * from ats_boards where token = ${TOKEN}`;
    expect(row).toMatchObject({
      provider: "greenhouse",
      region: null,
      enabled: true,
      last_fetch_at: null,
      last_status: null,
    });
    expect(row!.id).toBeTruthy();
    expect(row!.created_at).toBeInstanceOf(Date);
  });

  it("jobsearch_app no ve filas (RLS activo y sin policy)", async () => {
    const [seen] = await asApp((tx) => tx`select count(*)::int as n from ats_boards`);
    expect(seen!.n).toBe(0);
    const [rls] = await owner`
      select c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p
               where p.schemaname = 'public' and p.tablename = 'ats_boards') as policies
      from pg_class c where c.relname = 'ats_boards'`;
    expect(rls).toEqual({ rls: true, policies: 0 });
  });

  it("jobsearch_app no puede escribir", async () => {
    await expect(
      asApp(
        (tx) =>
          tx`insert into ats_boards (provider, token, company_name) values ('lever', 'otro-token', 'Empresa Ficticia 2')`,
      ),
    ).rejects.toThrow(/row-level security|permission denied/);
  });

  it("el check rechaza un provider inválido", async () => {
    await expect(
      owner`insert into ats_boards (provider, token, company_name)
            values ('workday', ${TOKEN + "-x"}, 'Empresa Ficticia 3')`,
    ).rejects.toThrow(/ats_boards_provider_check/);
  });

  it("el check del token rechaza /, :, espacios, @ y vacío", async () => {
    for (const bad of ["a/b", "a:b", "a b", "a@b", "", "-x", "x".repeat(101)]) {
      await expect(
        owner`insert into ats_boards (provider, token, company_name)
              values ('greenhouse', ${bad}, 'Empresa Ficticia 3')`,
      ).rejects.toThrow(/ats_boards_token_check/);
    }
  });

  it("el check de región: solo eu y solo en lever", async () => {
    await expect(
      owner`insert into ats_boards (provider, token, company_name, region)
            values ('greenhouse', ${TOKEN + "-g"}, 'Empresa Ficticia 3', 'eu')`,
    ).rejects.toThrow(/ats_boards_region_check/);
    await expect(
      owner`insert into ats_boards (provider, token, company_name, region)
            values ('lever', ${TOKEN + "-l"}, 'Empresa Ficticia 3', 'us')`,
    ).rejects.toThrow(/ats_boards_region_check/);
  });

  it("el check de región: teamtailor acepta na y rechaza eu", async () => {
    await owner`insert into ats_boards (provider, token, company_name, region)
                values ('teamtailor', ${TOKEN + "-t"}, 'Empresa Ficticia 4', 'na')`;
    await owner`delete from ats_boards where token = ${TOKEN + "-t"}`;
    await expect(
      owner`insert into ats_boards (provider, token, company_name, region)
            values ('teamtailor', ${TOKEN + "-e"}, 'Empresa Ficticia 4', 'eu')`,
    ).rejects.toThrow(/ats_boards_region_check/);
    await expect(
      owner`insert into ats_boards (provider, token, company_name, region)
            values ('lever', ${TOKEN + "-n"}, 'Empresa Ficticia 4', 'na')`,
    ).rejects.toThrow(/ats_boards_region_check/);
  });

  it("el unique rechaza (provider, token) duplicado, pero acepta otro provider", async () => {
    await expect(
      owner`insert into ats_boards (provider, token, company_name)
            values ('greenhouse', ${TOKEN}, 'Empresa Ficticia 1 bis')`,
    ).rejects.toThrow(/ats_boards_provider_token/);
    await owner`insert into ats_boards (provider, token, company_name, region)
                values ('lever', ${TOKEN}, 'Empresa Ficticia 1', 'eu')`;
    const [n] = await owner`select count(*)::int as n from ats_boards where token = ${TOKEN}`;
    expect(n!.n).toBe(2);
  });

  it("el enum source_kind tiene wwr, greenhouse, lever, ashby y teamtailor", async () => {
    const rows = await owner<{ v: string }[]>`
      select e.enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'source_kind'`;
    const values = rows.map((r) => r.v);
    for (const kind of ["wwr", "greenhouse", "lever", "ashby", "teamtailor"]) {
      expect(values).toContain(kind);
    }
  });
});
