import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Avisos «Ya pagué» (R22-01, rls/0053_payment_notices.sql) por el camino real: la app como jobsearch_app.
 * Una persona lee e inserta solo los suyos (siempre pendientes), no puede actualizarlos ni borrarlos, y no
 * pasa de 3 pendientes aunque los envíe a la vez. Datos inventados, con ids propios y limpieza al final.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A_ID = "d9500000-0000-4000-8000-000000000001";
const B_ID = "d9500000-0000-4000-8000-000000000002";
const C_ID = "d9500000-0000-4000-8000-000000000003";
const IDS = [A_ID, B_ID, C_ID];
const CAP = /payment_notices: tope de avisos pendientes/;

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, run: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx as unknown as Sql);
  })) as T;
}

const insertNotice = (userId: string, op: string | null = null) =>
  asUser(
    userId,
    (tx) =>
      tx`insert into payment_notices (user_id, plan, operation_number) values (${userId}, 'lista', ${op})`,
  );

const countOf = async (id: string) =>
  Number((await owner`select count(*)::int as n from payment_notices where user_id = ${id}`)[0]!.n);

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
  app = postgres(u.toString(), { max: 6, prepare: false });
  for (const [i, id] of IDS.entries()) {
    await owner`insert into users (id, email, name) values (${id}, ${`aviso-pago-${i}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`delete from payment_notices where user_id in ${owner(IDS)}`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from payment_notices where user_id in ${owner(IDS)}`;
    await owner`delete from users where id in ${owner(IDS)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("payment_notices: RLS", () => {
  it("una persona inserta su aviso y lee solo los suyos", async () => {
    await insertNotice(A_ID, "123456789");
    await insertNotice(B_ID);
    const mine = await asUser(
      A_ID,
      (tx) => tx`select user_id, status, operation_number from payment_notices`,
    );
    expect(mine).toEqual([{ user_id: A_ID, status: "pendiente", operation_number: "123456789" }]);
    const others = await asUser(
      A_ID,
      (tx) => tx`select 1 from payment_notices where user_id = ${B_ID}`,
    );
    expect(others).toHaveLength(0);
  });

  it("no puede crear avisos a nombre de otra persona", async () => {
    await expect(
      asUser(
        A_ID,
        (tx) => tx`insert into payment_notices (user_id, plan) values (${B_ID}, 'lista')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("no puede crear un aviso ya activado, rechazado ni resuelto", async () => {
    await expect(
      asUser(
        C_ID,
        (tx) =>
          tx`insert into payment_notices (user_id, plan, status, resolved_at) values (${C_ID}, 'lista', 'activado', now())`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(await countOf(C_ID)).toBe(0);
  });

  it("no puede actualizar ni borrar, ni los suyos ni los de otra persona", async () => {
    await expect(
      asUser(
        A_ID,
        (tx) => tx`update payment_notices set status = 'activado' where user_id = ${A_ID}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(A_ID, (tx) => tx`delete from payment_notices`)).rejects.toThrow(
      /permission denied/,
    );
    expect(
      (await owner`select status from payment_notices where user_id = ${A_ID}`)[0]!.status,
    ).toBe("pendiente");
  });

  it("la base solo acepta el número de operación con dígitos (CHECK)", async () => {
    for (const bad of ["12ab", "1".repeat(21), "12 34"]) {
      await expect(insertNotice(C_ID, bad)).rejects.toThrow(/payment_notices_operation_number/);
    }
    expect(await countOf(C_ID)).toBe(0);
  });

  it("al borrar la cuenta los avisos caen por cascade", async () => {
    const id = "d9500000-0000-4000-8000-0000000000aa";
    await owner`insert into users (id, email, name) values (${id}, 'cascada-aviso@ejemplo.test', 'Ficticio')`;
    await owner`insert into payment_notices (user_id, plan) values (${id}, 'lista')`;
    await owner`delete from users where id = ${id}`;
    expect(await countOf(id)).toBe(0);
  });
});

describe("payment_notices: tope de 3 pendientes", () => {
  it("el cuarto pendiente no se crea", async () => {
    await insertNotice(C_ID);
    await insertNotice(C_ID);
    await insertNotice(C_ID);
    await expect(insertNotice(C_ID)).rejects.toThrow(CAP);
    expect(await countOf(C_ID)).toBe(3);
  });

  it("los resueltos no cuentan para el tope", async () => {
    await owner`update payment_notices set status = 'activado', resolved_at = now()
      where id = (select id from payment_notices where user_id = ${C_ID} limit 1)`;
    await insertNotice(C_ID);
    expect(await countOf(C_ID)).toBe(4);
    await expect(insertNotice(C_ID)).rejects.toThrow(CAP);
  });

  it("con envíos a la vez no pasa el tope (carrera)", async () => {
    await owner`delete from payment_notices where user_id = ${B_ID}`;
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => insertNotice(B_ID)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(3);
    expect(await countOf(B_ID)).toBe(3);
  });

  it("el tope es por persona: otra persona sigue pudiendo avisar", async () => {
    await owner`delete from payment_notices where user_id = ${A_ID}`;
    await insertNotice(A_ID);
    expect(await countOf(A_ID)).toBe(1);
  });
});
