import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * user_skills (ronda 78, rls/0008): skills que la persona agrega a mano. Por el camino real, como
 * jobsearch_app (NOBYPASSRLS) con app.user_id fijado: una persona no ve ni escribe las filas de la
 * otra, no puede insertar a nombre de otra, el nombre es único por persona sin importar las
 * mayúsculas y las filas caen con la cuenta. Datos inventados.
 */
const A = "a9000000-0000-4000-8000-000000000001";
const B = "b9000000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
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

  await owner`insert into users (id, email, password_hash) values (${A}, 'a@skills.test', 'x'), (${B}, 'b@skills.test', 'x')`;
  await owner`insert into user_skills (user_id, name, level) values (${A}, 'Herramienta de A', 1), (${B}, 'Herramienta de B', 3)`;
}, 180_000);

afterAll(async () => {
  if (owner) await owner`delete from users where id in (${A}, ${B})`;
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("user_skills: RLS de dueño", () => {
  it("cada persona ve solo lo suyo", async () => {
    const rows = await asUser(A, (tx) => tx`select name from user_skills order by name`);
    expect(rows.map((r) => r.name)).toEqual(["Herramienta de A"]);
  });

  it("sin app.user_id no ve nada", async () => {
    const rows = await app.begin((tx) => tx`select name from user_skills`);
    expect(rows).toHaveLength(0);
  });

  it("no puede actualizar ni borrar las filas ajenas", async () => {
    const upd = await asUser(A, (tx) => tx`update user_skills set level = 0 where user_id = ${B}`);
    expect(upd.count).toBe(0);
    const del = await asUser(A, (tx) => tx`delete from user_skills where user_id = ${B}`);
    expect(del.count).toBe(0);
    const [row] = await owner`select level from user_skills where user_id = ${B}`;
    expect(row!.level).toBe(3);
  });

  it("no puede insertar a nombre de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into user_skills (user_id, name, level) values (${B}, 'Intrusa', 1)`,
      ),
    ).rejects.toThrow();
  });

  it("puede insertar lo propio; el nombre es único por persona sin importar mayúsculas", async () => {
    await asUser(
      A,
      (tx) => tx`insert into user_skills (user_id, name, level) values (${A}, 'Otra Cosa', 2)`,
    );
    await expect(
      asUser(
        A,
        (tx) => tx`insert into user_skills (user_id, name, level) values (${A}, 'OTRA cosa', 1)`,
      ),
    ).rejects.toThrow();
    // El mismo nombre en otra persona sí se puede
    await asUser(
      B,
      (tx) => tx`insert into user_skills (user_id, name, level) values (${B}, 'Otra Cosa', 1)`,
    );
  });

  it("rechaza niveles fuera de 0 a 3 y nombres de largo inválido", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into user_skills (user_id, name, level) values (${A}, 'Nivel Malo', 4)`,
      ),
    ).rejects.toThrow();
    await expect(
      asUser(A, (tx) => tx`insert into user_skills (user_id, name, level) values (${A}, 'x', 1)`),
    ).rejects.toThrow();
  });

  it("las filas caen con la cuenta (ON DELETE CASCADE)", async () => {
    const id = "c9000000-0000-4000-8000-000000000003";
    await owner`insert into users (id, email, password_hash) values (${id}, 'c@skills.test', 'x')`;
    await owner`insert into user_skills (user_id, name, level) values (${id}, 'Se va con la cuenta', 1)`;
    await owner`delete from users where id = ${id}`;
    const left = await owner`select 1 from user_skills where user_id = ${id}`;
    expect(left).toHaveLength(0);
  });
});
