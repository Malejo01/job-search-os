import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Ronda 83 · Re-aceptación de los términos. Como jobsearch_app, en una transacción con app.user_id
 * (igual que withUser): cada persona lee y actualiza SOLO su terms_version/terms_accepted_at, sin
 * funciones nuevas, con users_read y users_self_update de rls/0000. Datos inventados.
 */
const A = "a8300000-0000-4000-8000-000000000001";
const B = "b8300000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

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
  await owner`insert into users (id, email, password_hash, terms_version)
              values (${A}, 'a@terminos.test', 'x', null), (${B}, 'b@terminos.test', 'x', '2026-01-01')`;
}, 180_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("terms_version con la fila propia (RLS)", () => {
  it("una persona lee su versión (null si nunca aceptó) y no la de otra", async () => {
    const own = await asUser(A, (tx) => tx`select id, terms_version from users`);
    expect(own).toHaveLength(1);
    expect(own[0]!.id).toBe(A);
    expect(own[0]!.terms_version).toBeNull();
  });

  it("acepta: queda la versión y la fecha", async () => {
    const before = Date.now();
    await asUser(
      A,
      (tx) =>
        tx`update users set terms_version = '2026-10-20', terms_accepted_at = now() where id = ${A}`,
    );
    const [row] = await owner`select terms_version, terms_accepted_at from users where id = ${A}`;
    expect(row!.terms_version).toBe("2026-10-20");
    expect(Math.abs((row!.terms_accepted_at as Date).getTime() - before)).toBeLessThan(60_000);
  });

  it("no puede tocar a otra persona: 0 filas y la versión de B no cambia", async () => {
    const res = await asUser(
      A,
      (tx) => tx`update users set terms_version = '2026-10-20' where id = ${B}`,
    );
    expect(res.count).toBe(0);
    const [row] = await owner`select terms_version from users where id = ${B}`;
    expect(row!.terms_version).toBe("2026-01-01");
  });

  it("sin sesión (app.user_id vacío) no actualiza a nadie", async () => {
    const res = await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', '', true)`;
      return tx`update users set terms_version = 'x' where id = ${A}`;
    });
    expect(res.count).toBe(0);
    const [row] = await owner`select terms_version from users where id = ${A}`;
    expect(row!.terms_version).toBe("2026-10-20");
  });
});
