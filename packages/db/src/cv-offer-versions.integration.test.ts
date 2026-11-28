import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Versión del CV adaptada a una oferta (R34-02, rls/0076) por el camino real: la app como jobsearch_app. Nadie lee
 * ni toca la versión de otra persona; hay hasta 3 por persona y oferta (rls/0077); las restricciones de forma frenan valores
 * raros; la versión se va con la cuenta y con la oferta. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "e3400000-0000-4000-8000-0000000000a1";
const B = "e3400000-0000-4000-8000-0000000000b2";
const PROPOSAL = JSON.stringify({ entries: [], skills: [], changes: [] });

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let jobA = "";
let jobA2 = "";
let jobB = "";

async function asUser<T>(userId: string | null, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    if (userId) await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function newJob(userId: string, title: string): Promise<string> {
  const [j] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${userId}, 'Empresa A', ${title}, ${title.toLowerCase()}) returning id`;
  return j!.id;
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
  await owner`delete from jobs where user_id in ${owner([A, B])}`;
  jobA = await newJob(A, "Oferta A1");
  jobA2 = await newJob(A, "Oferta A2");
  jobB = await newJob(B, "Oferta B1");
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from jobs where user_id in ${owner([A, B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

describe("cv_offer_versions: forma", () => {
  it("RLS activo y FORCE", async () => {
    const [t] = await owner<{ rls: boolean; force: boolean }[]>`
      select relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname = 'cv_offer_versions' and relnamespace = 'public'::regnamespace`;
    expect(t).toEqual({ rls: true, force: true });
  });

  it("hasta 3 versiones por persona y oferta: la cuarta borra la más vieja", async () => {
    for (let n = 1; n <= 4; n++) {
      await asUser(
        A,
        (tx) =>
          tx`insert into cv_offer_versions (user_id, job_id, proposal) values (${A}, ${jobA}, ${JSON.stringify({ n })}::text::jsonb)`,
      );
    }
    const left = await owner<{ n: number }[]>`
      select (proposal->>'n')::int as n from cv_offer_versions where user_id = ${A} and job_id = ${jobA}
      order by created_at`;
    expect(left.map((r) => r.n)).toEqual([2, 3, 4]);
    // otra oferta de la misma persona sí entra
    await asUser(
      A,
      (tx) =>
        tx`insert into cv_offer_versions (user_id, job_id, proposal) values (${A}, ${jobA2}, ${PROPOSAL}::text::jsonb)`,
    );
  });

  it("restricciones: contenido que no es objeto o demasiado grande", async () => {
    const insert = (payload: string) =>
      asUser(
        B,
        (tx) =>
          tx`insert into cv_offer_versions (user_id, job_id, proposal) values (${B}, ${jobB}, ${payload}::text::jsonb)`,
      );
    await expect(insert("[1,2]")).rejects.toThrow(/cv_offer_versions_proposal/);
    await expect(insert(JSON.stringify({ t: "x".repeat(60_001) }))).rejects.toThrow(
      /cv_offer_versions_proposal/,
    );
    await insert(JSON.stringify({ de: "b" })); // este sí entra
  });
});

describe("cv_offer_versions: nadie lee la versión de otra persona", () => {
  it("cada persona ve solo lo suyo", async () => {
    const a = await asUser(
      A,
      (tx) => tx<{ job_id: string }[]>`select job_id from cv_offer_versions`,
    );
    const b = await asUser(
      B,
      (tx) => tx<{ job_id: string }[]>`select job_id from cv_offer_versions`,
    );
    expect([...new Set(a.map((r) => r.job_id))].sort()).toEqual([jobA, jobA2].sort());
    expect(a).toHaveLength(4);
    expect(b.map((r) => r.job_id)).toEqual([jobB]);
    const cruzado = await asUser(
      A,
      (tx) => tx`select * from cv_offer_versions where user_id = ${B}`,
    );
    expect(cruzado).toHaveLength(0);
  });

  it("sin persona fijada no se ve nada", async () => {
    const rows = await asUser(null, (tx) => tx`select * from cv_offer_versions`).catch(() => []);
    expect(rows).toHaveLength(0);
  });

  it("no se puede escribir a nombre de otra persona", async () => {
    await expect(
      asUser(
        A,
        (tx) =>
          tx`insert into cv_offer_versions (user_id, job_id, proposal) values (${B}, ${jobB}, ${PROPOSAL}::text::jsonb)`,
      ),
    ).rejects.toThrow(/row-level security|duplicate key/);
  });

  it("actualizar o borrar lo ajeno no toca nada", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update cv_offer_versions set updated_at = now() where user_id = ${B} returning id`,
    );
    expect(upd).toHaveLength(0);
    const del = await asUser(
      A,
      (tx) => tx`delete from cv_offer_versions where user_id = ${B} returning id`,
    );
    expect(del).toHaveLength(0);
    const [still] = await owner<{ proposal: { de: string } }[]>`
      select proposal from cv_offer_versions where user_id = ${B}`;
    expect(still?.proposal.de).toBe("b");
  });

  it("no se puede pasar una versión propia a otra persona", async () => {
    await expect(
      asUser(A, (tx) => tx`update cv_offer_versions set user_id = ${B} where user_id = ${A}`),
    ).rejects.toThrow(/row-level security/);
  });

  it("la persona cambia y borra lo suyo", async () => {
    const upd = await asUser(
      A,
      (tx) =>
        tx`update cv_offer_versions set proposal = ${JSON.stringify({ x: 1 })}::text::jsonb where job_id = ${jobA} returning id`,
    );
    expect(upd).toHaveLength(3);
    const del = await asUser(A, (tx) => tx`delete from cv_offer_versions returning id`);
    expect(del).toHaveLength(4);
  });
});

describe("cv_offer_versions: cascadas", () => {
  it("cae por cascada al borrar la oferta", async () => {
    const C = "e3400000-0000-4000-8000-0000000000c3";
    await owner`insert into users (id, email, name) values (${C}, 'c3@ejemplo.test', 'Ficticio')
      on conflict (id) do nothing`;
    const j = await newJob(C, "Oferta C1");
    await owner`insert into cv_offer_versions (user_id, job_id, proposal) values (${C}, ${j}, ${PROPOSAL}::text::jsonb)`;
    await owner`delete from jobs where id = ${j}`;
    expect(await owner`select 1 from cv_offer_versions where user_id = ${C}`).toHaveLength(0);
    await owner`delete from users where id = ${C}`;
  });

  it("cae por cascada al borrar la persona", async () => {
    const D = "e3400000-0000-4000-8000-0000000000d4";
    await owner`insert into users (id, email, name) values (${D}, 'd4@ejemplo.test', 'Ficticio')
      on conflict (id) do nothing`;
    const j = await newJob(D, "Oferta D1");
    await owner`insert into cv_offer_versions (user_id, job_id, proposal) values (${D}, ${j}, ${PROPOSAL}::text::jsonb)`;
    await owner`delete from users where id = ${D}`;
    expect(await owner`select 1 from cv_offer_versions where user_id = ${D}`).toHaveLength(0);
    await owner`delete from jobs where id = ${j}`;
  });
});
