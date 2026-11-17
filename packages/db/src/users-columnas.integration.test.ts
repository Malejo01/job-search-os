import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * R11-7 · users_self_update y columnas (rls/0021). Como jobsearch_app, en una transacción con
 * app.user_id (igual que withUser): la persona sigue pudiendo cambiar lo que la app le deja editar
 * (contraseña, versión de sesión, términos) y NO puede cambiar `is_test`, `email`, `id`, `name`.
 * Datos inventados.
 */
const A = "a2100000-0000-4000-8000-000000000001";
const B = "b2100000-0000-4000-8000-000000000002";
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
  await owner`insert into users (id, email, name, password_hash, is_test)
              values (${A}, 'cuenta-a-columnas', 'Persona A', 'x', false),
                     (${B}, 'cuenta-b-columnas', 'Persona B', 'x', true)`;
}, 180_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("users_self_update limitado a las columnas que la app edita (rls/0021)", () => {
  it("una persona no puede cambiar su propio is_test", async () => {
    await expect(
      asUser(A, (tx) => tx`update users set is_test = true where id = ${A}`),
    ).rejects.toThrow(/permission denied/i);
    const [row] = await owner`select is_test from users where id = ${A}`;
    expect(row!.is_test).toBe(false);
  });

  it("una cuenta de prueba tampoco puede sacarse la marca", async () => {
    await expect(
      asUser(B, (tx) => tx`update users set is_test = false where id = ${B}`),
    ).rejects.toThrow(/permission denied/i);
    const [row] = await owner`select is_test from users where id = ${B}`;
    expect(row!.is_test).toBe(true);
  });

  it("no puede cambiar su email, su nombre ni su id", async () => {
    for (const set of [
      (tx: postgres.TransactionSql) =>
        tx`update users set email = 'cuenta-otra-columnas' where id = ${A}`,
      (tx: postgres.TransactionSql) => tx`update users set name = 'Otra' where id = ${A}`,
      (tx: postgres.TransactionSql) => tx`update users set id = ${B} where id = ${A}`,
    ]) {
      await expect(asUser(A, set)).rejects.toThrow(/permission denied/i);
    }
    const [row] = await owner`select email, name from users where id = ${A}`;
    expect(row).toEqual({ email: "cuenta-a-columnas", name: "Persona A" });
  });

  it("sigue pudiendo cambiar lo que la app deja editar", async () => {
    await asUser(
      A,
      (tx) => tx`update users set password_hash = 'nuevo', session_version = session_version + 1,
                 updated_at = now() where id = ${A}`,
    );
    await asUser(
      A,
      (tx) =>
        tx`update users set terms_version = '2026-10-20', terms_accepted_at = now() where id = ${A}`,
    );
    const [row] =
      await owner`select password_hash, session_version, terms_version from users where id = ${A}`;
    expect(row).toEqual({
      password_hash: "nuevo",
      session_version: 1,
      terms_version: "2026-10-20",
    });
  });

  it("la policy sigue acotando a la fila propia: no toca la de otra persona", async () => {
    const res = await asUser(A, (tx) => tx`update users set terms_version = 'x' where id = ${B}`);
    expect(res.count).toBe(0);
  });

  it("el dueño (admin:test-users) sigue pudiendo marcar is_test", async () => {
    await owner`update users set is_test = true where id = ${A}`;
    const [row] = await owner`select is_test from users where id = ${A}`;
    expect(row!.is_test).toBe(true);
    await owner`update users set is_test = false where id = ${A}`;
  });
});
