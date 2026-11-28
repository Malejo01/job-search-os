import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Ficha del aviso (R31-01, rls/0071, ADR-048) por el camino real: la app como jobsearch_app. Una ficha por hash,
 * sin user_id; se lee solo si el hash coincide con una oferta propia o con un aviso del pool; la app no escribe.
 * Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "e3100000-0000-4000-8000-000000000001";
const B = "e3100000-0000-4000-8000-000000000002";
const H_PROPIO = "a1".repeat(32); // oferta de A
const H_POOL = "b2".repeat(32); // aviso del pool
const H_HUERFANO = "c3".repeat(32); // de nadie
const H_NUEVO = "d4".repeat(32);
const EXTERNAL_ID = "job-cards-rls-test";

const CARD = { resumen: null, tareas: [] }; // el contenido no importa para la RLS

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

const insertCard = (hash: string, status = "lista") =>
  owner`insert into job_cards (jd_hash, status, card, prompt_version, model)
        values (${hash}, ${status}, ${status === "lista" ? owner.json(CARD) : null}, 'extract_job_card.v1', 'modelo-ficticio')
        on conflict (jd_hash) do nothing`;

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
  await owner`delete from job_cards where jd_hash in ${owner([H_PROPIO, H_POOL, H_HUERFANO, H_NUEVO])}`;
  await owner`delete from public_jobs where external_id = ${EXTERNAL_ID}`;
  await owner`insert into jobs (user_id, company_raw, title, title_normalized, jd_hash)
    values (${A}, 'Empresa A', 'Analista', 'analista', ${H_PROPIO})`;
  await owner`insert into public_jobs (source_kind, external_id, source_name, source_url, title, title_normalized,
      company_raw, company_normalized, jd_hash, first_seen_at, last_seen_at)
    values ('remoteok', ${EXTERNAL_ID}, 'Remote OK', 'https://example.com/jobs/1', 'Backend Developer',
      'backend developer', 'Empresa B', 'empresa b', ${H_POOL}, now(), now())`;
  await insertCard(H_PROPIO);
  await insertCard(H_POOL);
  await insertCard(H_HUERFANO);
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from job_cards where jd_hash in ${owner([H_PROPIO, H_POOL, H_HUERFANO, H_NUEVO])}`;
    await owner`delete from jobs where user_id in ${owner([A, B])}`;
    await owner`delete from public_jobs where external_id = ${EXTERNAL_ID}`;
    await owner`delete from users where id in ${owner([A, B])}`;
    await owner.end();
  }
  await app?.end();
  await container?.stop();
});

const visibles = (as: string) =>
  asUser(
    as,
    (tx) => tx<{ jd_hash: string }[]>`select jd_hash from job_cards order by jd_hash`,
  ).then((r) => r.map((x) => x.jd_hash));

describe("job_cards: forma", () => {
  it("la tabla no lleva user_id ni nada que diga quién la pidió", async () => {
    const cols = await owner<{ column_name: string }[]>`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'job_cards'`;
    const nombres = cols.map((c) => c.column_name);
    expect(nombres).not.toContain("user_id");
    expect(nombres.filter((n) => /user|requested|owner/i.test(n))).toEqual([]);
  });

  it("RLS activo y FORCE", async () => {
    const [t] = await owner<{ rls: boolean; force: boolean }[]>`
      select relrowsecurity as rls, relforcerowsecurity as force from pg_class
      where relname = 'job_cards' and relnamespace = 'public'::regnamespace`;
    expect(t).toEqual({ rls: true, force: true });
  });

  it("una sola fila por hash: la restricción única", async () => {
    await expect(
      owner`insert into job_cards (jd_hash, status) values (${H_HUERFANO}, 'fallida')`,
    ).rejects.toThrow(/job_cards_jd_hash|duplicate key/);
  });

  it("el CHECK: la ficha solo existe con estado lista, y el hash tiene forma de sha256", async () => {
    await expect(
      owner`insert into job_cards (jd_hash, status, card) values (${H_NUEVO}, 'fallida', ${owner.json(CARD)})`,
    ).rejects.toThrow(/job_cards_card_only_if_ready/);
    await expect(
      owner`insert into job_cards (jd_hash, status) values (${H_NUEVO}, 'lista')`,
    ).rejects.toThrow(/job_cards_card_only_if_ready/);
    await expect(
      owner`insert into job_cards (jd_hash, status) values ('no-es-un-hash', 'fallida')`,
    ).rejects.toThrow(/job_cards_hash_shape/);
    await expect(
      owner`insert into job_cards (jd_hash, status) values (${H_NUEVO}, 'rara')`,
    ).rejects.toThrow(/job_cards_status/);
  });
});

describe("job_cards: lectura de la app", () => {
  it("caso 1: ve la ficha cuyo hash coincide con una oferta suya, y la del pool", async () => {
    expect(await visibles(A)).toEqual([H_PROPIO, H_POOL].sort());
  });

  it("caso 2: otra persona ve la del pool y no la de la oferta ajena", async () => {
    expect(await visibles(B)).toEqual([H_POOL]);
  });

  it("caso negado: la ficha que no coincide con ninguna oferta suya ni del pool no se ve", async () => {
    for (const quien of [A, B]) expect(await visibles(quien)).not.toContain(H_HUERFANO);
  });

  it("sin persona en el contexto no se ve la de una oferta propia", async () => {
    const r = await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', '', true)`;
      return tx<{ jd_hash: string }[]>`select jd_hash from job_cards where jd_hash = ${H_PROPIO}`;
    });
    expect(r).toHaveLength(0);
  });
});

describe("job_cards: escritura", () => {
  it("la app no inserta, no actualiza y no borra", async () => {
    await expect(
      asUser(A, (tx) => tx`insert into job_cards (jd_hash, status) values (${H_NUEVO}, 'fallida')`),
    ).rejects.toThrow(/permission denied|row-level security/);
    await expect(
      asUser(
        A,
        (tx) =>
          tx`update job_cards set status = 'fallida', card = null where jd_hash = ${H_PROPIO}`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(A, (tx) => tx`delete from job_cards where jd_hash = ${H_PROPIO}`),
    ).rejects.toThrow(/permission denied/);
    const [c] = await owner<
      { status: string }[]
    >`select status from job_cards where jd_hash = ${H_PROPIO}`;
    expect(c?.status).toBe("lista");
  });

  it("el proceso de servicio (dueño) escribe, también con FORCE", async () => {
    await insertCard(H_NUEVO, "sin_texto");
    const r =
      await owner`update job_cards set attempts = attempts + 1 where jd_hash = ${H_NUEVO} returning attempts`;
    expect(r[0]?.attempts).toBe(1);
    await owner`delete from job_cards where jd_hash = ${H_NUEVO}`;
  });

  it("concurrencia: varias escrituras a la vez del mismo hash dejan una sola ficha", async () => {
    await Promise.all(Array.from({ length: 8 }, () => insertCard(H_NUEVO)));
    const [n] = await owner<
      { n: number }[]
    >`select count(*)::int as n from job_cards where jd_hash = ${H_NUEVO}`;
    expect(n?.n).toBe(1);
    await owner`delete from job_cards where jd_hash = ${H_NUEVO}`;
  });
});
