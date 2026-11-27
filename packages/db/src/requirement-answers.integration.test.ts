import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Respuestas de un toque a lo que pide el aviso (R31-05, rls/0072) por el camino real: la app como
 * jobsearch_app. Cada persona ve y cambia solo lo suyo; la respuesta es una por persona y clave; las
 * restricciones de forma frenan valores raros; cae con la cuenta. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "e3100000-0000-4000-8000-0000000000a1";
const B = "e3100000-0000-4000-8000-0000000000b2";
const KEY = "formacion:titulo universitario";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    if (userId) await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

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
  owner = postgres(ownerUrl, { max: 6, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of [A, B]) {
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  await owner`delete from requirement_answers where user_id in ${owner([A, B])}`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from requirement_answers where user_id in ${owner([A, B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

describe("requirement_answers: forma", () => {
  it("RLS activo y FORCE", async () => {
    const [t] = await owner<{ rls: boolean; force: boolean }[]>`
      select relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname = 'requirement_answers' and relnamespace = 'public'::regnamespace`;
    expect(t).toEqual({ rls: true, force: true });
  });

  it("la respuesta es una por persona y clave", async () => {
    await asUser(
      A,
      (tx) => tx`insert into requirement_answers (user_id, req_key, answer)
      values (${A}, ${KEY}, 'si')`,
    );
    await expect(
      asUser(
        A,
        (tx) => tx`insert into requirement_answers (user_id, req_key, answer)
        values (${A}, ${KEY}, 'no')`,
      ),
    ).rejects.toThrow(/duplicate key|requirement_answers_user_key/);
  });

  it("restricciones: respuesta desconocida, clave vacía o larga, nota fuera de «En parte» o larga", async () => {
    const insert = (key: string, answer: string, note: string | null) =>
      asUser(
        B,
        (tx) => tx`insert into requirement_answers (user_id, req_key, answer, note)
          values (${B}, ${key}, ${answer}, ${note})`,
      );
    await expect(insert("k1", "capaz", null)).rejects.toThrow(/requirement_answers_answer/);
    await expect(insert("", "si", null)).rejects.toThrow(/requirement_answers_key/);
    await expect(insert("k".repeat(161), "si", null)).rejects.toThrow(/requirement_answers_key/);
    await expect(insert("k2", "si", "una nota")).rejects.toThrow(/requirement_answers_note/);
    await expect(insert("k3", "en_parte", "n".repeat(201))).rejects.toThrow(
      /requirement_answers_note/,
    );
    await insert("k4", "en_parte", "Cursando el último año"); // esta sí entra
    await owner`delete from requirement_answers where user_id = ${B}`;
  });
});

describe("requirement_answers: aislamiento entre personas", () => {
  it("cada persona ve solo lo suyo", async () => {
    await asUser(
      B,
      (tx) => tx`insert into requirement_answers (user_id, req_key, answer)
      values (${B}, ${KEY}, 'no')`,
    );
    const a = await asUser(
      A,
      (tx) => tx<{ answer: string }[]>`select answer from requirement_answers`,
    );
    const b = await asUser(
      B,
      (tx) => tx<{ answer: string }[]>`select answer from requirement_answers`,
    );
    expect(a.map((r) => r.answer)).toEqual(["si"]);
    expect(b.map((r) => r.answer)).toEqual(["no"]);
  });

  it("sin persona fijada no se ve nada", async () => {
    const rows = await asUser(null, (tx) => tx`select * from requirement_answers`).catch(() => []);
    expect(rows).toHaveLength(0);
  });

  it("no se puede escribir a nombre de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) => tx`insert into requirement_answers (user_id, req_key, answer)
        values (${B}, 'otra:clave', 'si')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("actualizar o borrar lo ajeno no toca nada", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update requirement_answers set answer = 'si' where user_id = ${B} returning id`,
    );
    expect(upd).toHaveLength(0);
    const del = await asUser(
      A,
      (tx) => tx`delete from requirement_answers where user_id = ${B} returning id`,
    );
    expect(del).toHaveLength(0);
    const [still] = await owner<{ answer: string }[]>`
      select answer from requirement_answers where user_id = ${B}`;
    expect(still?.answer).toBe("no");
  });

  it("no se puede pasar una fila propia a otra persona", async () => {
    await expect(
      asUser(A, (tx) => tx`update requirement_answers set user_id = ${B} where user_id = ${A}`),
    ).rejects.toThrow(/row-level security/);
  });

  it("la persona cambia y borra lo suyo", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update requirement_answers set answer = 'en_parte', note = 'Casi' returning id`,
    );
    expect(upd).toHaveLength(1);
    const del = await asUser(A, (tx) => tx`delete from requirement_answers returning id`);
    expect(del).toHaveLength(1);
  });

  it("cae con la cuenta (cascada)", async () => {
    const C = "e3100000-0000-4000-8000-0000000000c3";
    await owner`insert into users (id, email, name) values (${C}, 'c3@ejemplo.test', 'Ficticio')
      on conflict (id) do nothing`;
    await owner`insert into requirement_answers (user_id, req_key, answer) values (${C}, ${KEY}, 'si')`;
    await owner`delete from users where id = ${C}`;
    const left = await owner`select 1 from requirement_answers where user_id = ${C}`;
    expect(left).toHaveLength(0);
  });
});
