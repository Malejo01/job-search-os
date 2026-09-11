import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "./env";
import { applyMigrations } from "./migrate";

/**
 * JS-009 · Aislamiento RLS entre usuarios, por el camino real: la app se conecta como
 * jobsearch_app (sin ownership ni BYPASSRLS) y setea app.user_id por transacción.
 * Entornos:
 * - CI: DATABASE_URL (servicio postgres, dueño); la contraseña de jobsearch_app la fija el test.
 * - Local: Testcontainer pgvector/pgvector:pg16.
 * - Nube (TEST_DB_TARGET=cloud, pnpm test:integration:cloud): DATABASE_URL_UNPOOLED como dueño y
 *   DATABASE_URL_APP tal cual está en .env.local: el mismo rol y la misma URL pooled que usa la app.
 * Incluye un control negativo: sin la policy, el aislamiento desaparece y la aserción debe fallar.
 */
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let ownerUrl: string;
let appUrl: string;
let owner: Sql;

/** Conexión como la app para un usuario: cada query corre en su transacción con app.user_id. */
function asUser(userId: string | null) {
  const sql = postgres(appUrl, { max: 1, prepare: false });
  return {
    sql,
    async run<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      return sql.begin(async (tx) => {
        if (userId) await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
        return fn(tx as unknown as Sql);
      }) as Promise<T>;
    },
    close: () => sql.end(),
  };
}

beforeAll(async () => {
  if (process.env.TEST_DB_TARGET === "cloud") {
    loadLocalEnv();
    ownerUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
    if (!ownerUrl || !process.env.DATABASE_URL_APP) {
      throw new Error("modo cloud: faltan DATABASE_URL_UNPOOLED / DATABASE_URL_APP en .env.local");
    }
  } else if (process.env.DATABASE_URL) {
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
  if (process.env.DATABASE_URL_APP) {
    // Rol real con su contraseña real: no se toca
    appUrl = process.env.DATABASE_URL_APP;
  } else {
    await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
    const u = new URL(ownerUrl);
    u.username = "jobsearch_app";
    u.password = APP_PASSWORD;
    appUrl = u.toString();
  }
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("RLS entre usuarios (JS-009)", () => {
  it("las tablas de usuario tienen RLS activo y forzado también para el dueño", async () => {
    const rows = await owner<{ relname: string; rls: boolean; force: boolean }[]>`
      select relname, relrowsecurity as rls, relforcerowsecurity as force
      from pg_class where relname in ('jobs','evaluations','applications') order by relname`;
    expect(rows).toEqual([
      { relname: "applications", rls: true, force: true },
      { relname: "evaluations", rls: true, force: true },
      { relname: "jobs", rls: true, force: true },
    ]);
  });

  it("el rol de la app no es dueño ni saltea RLS", async () => {
    const [role] =
      await owner`select rolbypassrls, rolsuper from pg_roles where rolname = 'jobsearch_app'`;
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
    const [tbl] =
      await owner`select pg_get_userbyid(relowner) as owner from pg_class where relname = 'jobs'`;
    expect(tbl!.owner).not.toBe("jobsearch_app");
  });

  it("A inserta y ve sus filas; B no las ve, no las modifica y no inserta a nombre de A", async () => {
    const a = asUser(A);
    const b = asUser(B);
    try {
      await a.run(async (tx) => {
        await tx`insert into profiles (user_id, display_name, location_country, inbound_address)
                 values (${A}, 'A', 'AR', 'u_a@ingest.test') on conflict do nothing`;
        await tx`insert into jobs (user_id, company_raw, title, title_normalized)
                 values (${A}, 'Acme', 'AI Engineer', 'ai engineer')`;
      });
      const seenByA = await a.run((tx) => tx`select count(*)::int as n from jobs`);
      expect(seenByA[0]!.n).toBe(1);

      const seenByB = await b.run((tx) => tx`select count(*)::int as n from jobs`);
      expect(seenByB[0]!.n).toBe(0);

      const updatedByB = await b.run(
        (tx) => tx`update jobs set title = 'hack' where user_id = ${A}`,
      );
      expect(updatedByB.count).toBe(0);

      await expect(
        b.run(
          (tx) => tx`insert into jobs (user_id, company_raw, title, title_normalized)
                     values (${A}, 'Acme', 'Backend', 'backend')`,
        ),
      ).rejects.toThrow(/row-level security/);

      const anonymous = asUser(null);
      const seenByNobody = await anonymous.run((tx) => tx`select count(*)::int as n from jobs`);
      expect(seenByNobody[0]!.n).toBe(0);
      await anonymous.close();
    } finally {
      await a.close();
      await b.close();
    }
  });

  it("control negativo: sin la policy de jobs, B SÍ ve las filas de A (el test mide algo)", async () => {
    const b = asUser(B);
    try {
      await owner.unsafe(`alter table jobs disable row level security`);
      const leaked = await b.run(
        (tx) => tx`select count(*)::int as n from jobs where user_id = ${A}`,
      );
      expect(leaked[0]!.n).toBeGreaterThan(0);
    } finally {
      await owner.unsafe(`alter table jobs enable row level security`);
      await b.close();
    }
    // Restaurada la policy, vuelve el aislamiento
    const b2 = asUser(B);
    try {
      const again = await b2.run((tx) => tx`select count(*)::int as n from jobs`);
      expect(again[0]!.n).toBe(0);
    } finally {
      await b2.close();
    }
  });

  it("limpieza como dueño (bypass): borra lo que insertó A", async () => {
    await owner`delete from jobs where user_id = ${A}`;
    await owner`delete from profiles where user_id = ${A}`;
    const [left] = await owner`select count(*)::int as n from jobs where user_id = ${A}`;
    expect(left!.n).toBe(0);
  });
});
