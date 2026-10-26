import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * «Contanos qué pasó» (C-23, rls/0013) por el camino real: la app como jobsearch_app. La persona
 * inserta y lee lo suyo; el admin lee las últimas 50 por admin_beta_feedback(), sin email ni nombre.
 * Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "e2300000-0000-4000-8000-0000000000aa";
const A = "e2300000-0000-4000-8000-000000000001";
const B = "e2300000-0000-4000-8000-000000000002";
const ALL = [ADMIN_ID, A, B];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

const insertAs = (userId: string, ownerOfRow: string, category = "idea", message = "Mensaje") =>
  asUser(
    userId,
    (tx) => tx`insert into beta_feedback (user_id, category, message, path)
               values (${ownerOfRow}, ${category}, ${message}, '/hoy')`,
  );

beforeAll(async () => {
  let ownerUrl: string;
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
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of ALL) {
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from beta_feedback where user_id in ${owner(ALL)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("beta_feedback (C-23)", () => {
  it("la persona inserta lo suyo y lo lee; la otra no lo ve", async () => {
    await insertAs(A, A, "algo_no_anduvo", "No me cargó la lista");
    const mine = await asUser(A, (tx) => tx`select message from beta_feedback`);
    expect(mine.map((r) => r.message)).toEqual(["No me cargó la lista"]);
    expect(await asUser(B, (tx) => tx`select 1 from beta_feedback`)).toHaveLength(0);
  });

  it("nadie inserta con el user_id de otra persona", async () => {
    await expect(insertAs(B, A)).rejects.toThrow(/row-level security/);
  });

  it("sin UPDATE ni DELETE para la app: afectan 0 filas", async () => {
    const upd = await asUser(A, (tx) => tx`update beta_feedback set message = 'otro'`);
    expect(upd.count).toBe(0);
    const del = await asUser(A, (tx) => tx`delete from beta_feedback`);
    expect(del.count).toBe(0);
    const [n] = await owner`select count(*)::int as n from beta_feedback where user_id = ${A}`;
    expect(n!.n).toBe(1);
  });

  it("los CHECK: categoría, largo del mensaje y del path", async () => {
    await expect(insertAs(A, A, "otra_cosa")).rejects.toThrow(/beta_feedback_category/);
    await expect(insertAs(A, A, "idea", "")).rejects.toThrow(/beta_feedback_message_length/);
    await expect(insertAs(A, A, "idea", "x".repeat(2001))).rejects.toThrow(
      /beta_feedback_message_length/,
    );
    await insertAs(A, A, "confuso", "x".repeat(2000));
    await expect(
      asUser(
        A,
        (tx) => tx`insert into beta_feedback (user_id, category, message, path)
                   values (${A}, 'idea', 'Mensaje', ${"/" + "p".repeat(200)})`,
      ),
    ).rejects.toThrow(/beta_feedback_path_length/);
  });

  it("el admin lee por admin_beta_feedback: ordenado, con persona opaca y sin email ni nombre", async () => {
    await insertAs(B, B, "idea", "Mensaje de B");
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_beta_feedback()`);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "category",
      "created_at",
      "message",
      "path",
      "person",
    ]);
    for (const r of rows) expect(r.person).toMatch(/^[0-9a-f]{6}$/);
    const times = rows.map((r) => new Date(r.created_at as string).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    // Mismo hash para la misma persona, distinto entre personas
    const byMessage = new Map(rows.map((r) => [r.message, r.person]));
    expect(byMessage.get("Mensaje de B")).not.toBe(byMessage.get("No me cargó la lista"));
  });

  it("el admin ve como máximo las últimas 50", async () => {
    await owner`insert into beta_feedback (user_id, category, message, path)
      select ${B}, 'idea', 'masivo ' || g, '/hoy' from generate_series(1, 60) g`;
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_beta_feedback()`);
    expect(rows).toHaveLength(50);
  });

  it("quien no es admin no puede llamar a la función", async () => {
    await expect(asUser(A, (tx) => tx`select * from admin_beta_feedback()`)).rejects.toThrow(
      /admin_beta_feedback: no autorizado/,
    );
  });

  it("borrar la cuenta se lleva sus filas (cascade)", async () => {
    await owner`delete from users where id = ${B}`;
    const [n] = await owner`select count(*)::int as n from beta_feedback where user_id = ${B}`;
    expect(n!.n).toBe(0);
  });
});
