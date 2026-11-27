import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Borrador automático del CV (R33-02, rls/0075) por el camino real: la app como jobsearch_app. Nadie lee ni toca
 * el borrador de otra persona; hay uno por persona y asistente; las restricciones de forma frenan valores raros;
 * el borrador se va con la cuenta. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "e3300000-0000-4000-8000-0000000000a1";
const B = "e3300000-0000-4000-8000-0000000000b2";
const PAYLOAD = JSON.stringify({ v: 1, cards: [] });

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
  await owner`delete from cv_drafts where user_id in ${owner([A, B])}`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from cv_drafts where user_id in ${owner([A, B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

describe("cv_drafts: forma", () => {
  it("RLS activo y FORCE", async () => {
    const [t] = await owner<{ rls: boolean; force: boolean }[]>`
      select relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname = 'cv_drafts' and relnamespace = 'public'::regnamespace`;
    expect(t).toEqual({ rls: true, force: true });
  });

  it("hay un borrador por persona y asistente", async () => {
    await asUser(
      A,
      (tx) =>
        tx`insert into cv_drafts (user_id, kind, payload) values (${A}, 'chat', ${PAYLOAD}::text::jsonb)`,
    );
    await expect(
      asUser(
        A,
        (tx) =>
          tx`insert into cv_drafts (user_id, kind, payload) values (${A}, 'chat', ${PAYLOAD}::text::jsonb)`,
      ),
    ).rejects.toThrow(/duplicate key|cv_drafts_user_kind/);
    // el otro asistente sí entra
    await asUser(
      A,
      (tx) =>
        tx`insert into cv_drafts (user_id, kind, payload) values (${A}, 'coach', ${PAYLOAD}::text::jsonb)`,
    );
  });

  it("restricciones: asistente desconocido, contenido que no es objeto o demasiado grande", async () => {
    const insert = (kind: string, payload: string) =>
      asUser(
        B,
        (tx) =>
          tx`insert into cv_drafts (user_id, kind, payload) values (${B}, ${kind}, ${payload}::text::jsonb)`,
      );
    await expect(insert("otro", PAYLOAD)).rejects.toThrow(/cv_drafts_kind/);
    await expect(insert("chat", "[1,2]")).rejects.toThrow(/cv_drafts_payload/);
    await expect(insert("chat", JSON.stringify({ t: "x".repeat(60_001) }))).rejects.toThrow(
      /cv_drafts_payload/,
    );
    await insert("chat", PAYLOAD); // este sí entra
    await owner`delete from cv_drafts where user_id = ${B}`;
  });
});

describe("cv_drafts: nadie lee el borrador de otra persona", () => {
  it("cada persona ve solo lo suyo", async () => {
    await asUser(
      B,
      (tx) =>
        tx`insert into cv_drafts (user_id, kind, payload) values (${B}, 'chat', ${JSON.stringify({ v: 1, de: "b" })}::text::jsonb)`,
    );
    const a = await asUser(
      A,
      (tx) => tx<{ kind: string }[]>`select kind from cv_drafts order by kind`,
    );
    const b = await asUser(
      B,
      (tx) => tx<{ kind: string }[]>`select kind from cv_drafts order by kind`,
    );
    expect(a.map((r) => r.kind)).toEqual(["chat", "coach"]);
    expect(b.map((r) => r.kind)).toEqual(["chat"]);
    const cruzado = await asUser(A, (tx) => tx`select payload from cv_drafts where user_id = ${B}`);
    expect(cruzado).toHaveLength(0);
  });

  it("sin persona fijada no se ve nada", async () => {
    const rows = await asUser(null, (tx) => tx`select * from cv_drafts`).catch(() => []);
    expect(rows).toHaveLength(0);
  });

  it("no se puede escribir a nombre de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) =>
          tx`insert into cv_drafts (user_id, kind, payload) values (${B}, 'coach', ${PAYLOAD}::text::jsonb)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("actualizar o borrar lo ajeno no toca nada", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update cv_drafts set updated_at = now() where user_id = ${B} returning id`,
    );
    expect(upd).toHaveLength(0);
    const del = await asUser(
      A,
      (tx) => tx`delete from cv_drafts where user_id = ${B} returning id`,
    );
    expect(del).toHaveLength(0);
    const [still] = await owner<{ payload: { de: string } }[]>`
      select payload from cv_drafts where user_id = ${B}`;
    expect(still?.payload.de).toBe("b");
  });

  it("no se puede pasar un borrador propio a otra persona", async () => {
    await expect(
      asUser(A, (tx) => tx`update cv_drafts set user_id = ${B} where user_id = ${A}`),
    ).rejects.toThrow(/row-level security/);
  });

  it("la persona cambia y borra lo suyo", async () => {
    const upd = await asUser(
      A,
      (tx) =>
        tx`update cv_drafts set payload = ${JSON.stringify({ v: 1, x: 1 })}::text::jsonb where kind = 'chat' returning id`,
    );
    expect(upd).toHaveLength(1);
    const del = await asUser(A, (tx) => tx`delete from cv_drafts returning id`);
    expect(del).toHaveLength(2);
  });
});

describe("cv_drafts: se va con la cuenta", () => {
  it("cae por cascada al borrar la persona", async () => {
    const C = "e3300000-0000-4000-8000-0000000000c3";
    await owner`insert into users (id, email, name) values (${C}, 'c3@ejemplo.test', 'Ficticio')
      on conflict (id) do nothing`;
    await owner`insert into cv_drafts (user_id, kind, payload) values (${C}, 'chat', ${PAYLOAD}::text::jsonb)`;
    await owner`insert into cv_drafts (user_id, kind, payload) values (${C}, 'coach', ${PAYLOAD}::text::jsonb)`;
    await owner`delete from users where id = ${C}`;
    const left = await owner`select 1 from cv_drafts where user_id = ${C}`;
    expect(left).toHaveLength(0);
  });
});
