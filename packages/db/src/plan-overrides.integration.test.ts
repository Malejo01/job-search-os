import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Precio especial por persona (ADR-040, rls/0022_plan_overrides.sql) por el camino real: la app como
 * jobsearch_app. Una persona lee solo su marca y no puede escribirla (ni la suya ni la de otra); solo una
 * cuenta de app_admins la pone, la cambia o la saca, por las funciones. Datos inventados, con ids propios
 * y limpieza al final (la base puede ser compartida en el CI).
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9400000-0000-4000-8000-000000000001";
const PERSON_ID = "d9400000-0000-4000-8000-000000000002";
const OTHER_ID = "d9400000-0000-4000-8000-000000000003";
const IDS = [ADMIN_ID, PERSON_ID, OTHER_ID];
const EMAILS = [
  "admin-override@ejemplo.test",
  "persona-override@ejemplo.test",
  "otra-override@ejemplo.test",
];
const [, PERSON_EMAIL, OTHER_EMAIL] = EMAILS as [string, string, string];
const DENIED = /admin_plan_override: no autorizado/;

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx as unknown as Sql);
  })) as T;
}

const overrideOf = async (id: string) =>
  (await owner`select override from plan_overrides where user_id = ${id}`)[0]?.override ?? null;

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
  for (const [i, id] of IDS.entries()) {
    await owner`insert into users (id, email, name) values (${id}, ${EMAILS[i]!}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
  await owner`delete from plan_overrides where user_id in ${owner(IDS)}`;
  await owner`insert into plan_overrides (user_id, override) values (${PERSON_ID}, 'tester_50')`;
  await owner`insert into plan_overrides (user_id, override) values (${OTHER_ID}, 'becado')`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from plan_overrides where user_id in ${owner(IDS)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(IDS)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("plan_overrides: lo que puede hacer una persona", () => {
  it("lee solo su fila, no la de otra", async () => {
    const mine = await asUser(PERSON_ID, (tx) => tx`select user_id, override from plan_overrides`);
    expect(mine).toEqual([{ user_id: PERSON_ID, override: "tester_50" }]);
    const others = await asUser(
      PERSON_ID,
      (tx) => tx`select 1 from plan_overrides where user_id = ${OTHER_ID}`,
    );
    expect(others).toHaveLength(0);
  });

  it("no puede insertar su propia marca, ni la de otra", async () => {
    await owner`delete from plan_overrides where user_id = ${ADMIN_ID}`;
    await expect(
      asUser(
        ADMIN_ID,
        (tx) => tx`insert into plan_overrides (user_id, override) values (${ADMIN_ID}, 'becado')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser(
        PERSON_ID,
        (tx) => tx`insert into plan_overrides (user_id, override) values (${PERSON_ID}, 'becado')`,
      ),
    ).rejects.toThrow();
    expect(await overrideOf(ADMIN_ID)).toBeNull();
    expect(await overrideOf(PERSON_ID)).toBe("tester_50");
  });

  it("no puede cambiar ni borrar su marca, ni la de otra", async () => {
    const upd = await asUser(
      PERSON_ID,
      (tx) => tx`update plan_overrides set override = 'becado' where user_id = ${PERSON_ID}`,
    );
    expect(upd.count).toBe(0);
    const updOther = await asUser(
      PERSON_ID,
      (tx) => tx`update plan_overrides set override = 'tester_50' where user_id = ${OTHER_ID}`,
    );
    expect(updOther.count).toBe(0);
    const del = await asUser(PERSON_ID, (tx) => tx`delete from plan_overrides`);
    expect(del.count).toBe(0);
    expect(await overrideOf(PERSON_ID)).toBe("tester_50");
    expect(await overrideOf(OTHER_ID)).toBe("becado");
  });

  it("no puede ponerse una marca con las funciones de admin", async () => {
    await expect(
      asUser(PERSON_ID, (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL}, 'becado')`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(PERSON_ID, (tx) => tx`select admin_plan_override_set(${OTHER_EMAIL}, null)`),
    ).rejects.toThrow(DENIED);
    await expect(
      asUser(PERSON_ID, (tx) => tx`select * from admin_plan_override_list(10)`),
    ).rejects.toThrow(DENIED);
    expect(await overrideOf(PERSON_ID)).toBe("tester_50");
    expect(await overrideOf(OTHER_ID)).toBe("becado");
  });

  it("la base solo acepta las dos marcas (CHECK)", async () => {
    await expect(
      owner`insert into plan_overrides (user_id, override) values (${ADMIN_ID}, 'gratis_para_siempre')`,
    ).rejects.toThrow(/plan_overrides_override/);
  });
});

describe("plan_overrides: lo que puede hacer el admin", () => {
  it("pone, cambia y saca la marca por email, sin importar mayúsculas", async () => {
    const [set] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL.toUpperCase()}, 'becado') as ok`,
    );
    expect(set!.ok).toBe(true);
    expect(await overrideOf(PERSON_ID)).toBe("becado");

    // Con la marca nueva, la persona la ve (sin poder tocarla)
    const mine = await asUser(PERSON_ID, (tx) => tx`select override from plan_overrides`);
    expect(mine).toEqual([{ override: "becado" }]);

    await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL}, 'tester_50')`,
    );
    expect(await overrideOf(PERSON_ID)).toBe("tester_50");

    const [cleared] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL}, null) as ok`,
    );
    expect(cleared!.ok).toBe(true);
    expect(await overrideOf(PERSON_ID)).toBeNull();
  });

  it("la lista muestra las marcas con email", async () => {
    await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL}, 'tester_50')`,
    );
    const rows = await asUser(ADMIN_ID, (tx) => tx`select * from admin_plan_override_list(200)`);
    expect(rows.find((r) => r.email === PERSON_EMAIL)).toMatchObject({ override: "tester_50" });
    expect(rows.find((r) => r.email === OTHER_EMAIL)).toMatchObject({ override: "becado" });
  });

  it("rechaza una marca inválida y devuelve false si la persona no existe", async () => {
    await expect(
      asUser(ADMIN_ID, (tx) => tx`select admin_plan_override_set(${PERSON_EMAIL}, 'gratis')`),
    ).rejects.toThrow(/marca inválida/);
    const [none] = await asUser(
      ADMIN_ID,
      (tx) => tx`select admin_plan_override_set('nadie-override@ejemplo.test', 'becado') as ok`,
    );
    expect(none!.ok).toBe(false);
    expect(await overrideOf(PERSON_ID)).toBe("tester_50");
  });

  it("al borrar la cuenta la marca cae por cascade", async () => {
    const id = "d9400000-0000-4000-8000-0000000000aa";
    await owner`insert into users (id, email, name) values (${id}, 'cascada-override@ejemplo.test', 'Ficticio')`;
    await owner`insert into plan_overrides (user_id, override) values (${id}, 'becado')`;
    await owner`delete from users where id = ${id}`;
    expect(await overrideOf(id)).toBeNull();
  });
});
