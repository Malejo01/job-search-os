import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Pool global de ofertas (ADR-014) · RLS de las tablas sin user_id, por el camino real: la app se
 * conecta como jobsearch_app. Las tres tablas de lectura se ven, no se escriben; la bitácora de
 * descargas no se ve. Siembra como dueño (bypass), que es como escribe el servicio.
 */
const USER = "11111111-1111-1111-1111-111111111111";
const APP_PASSWORD = "jobsearch_app_test";
const EXTERNAL_ID = "pool-rls-test-1";

let container: StartedPostgreSqlContainer | null = null;
let ownerUrl: string;
let appUrl: string;
let owner: Sql;
let publicJobId: string;
let skillId: string;

async function asApp<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(appUrl, { max: 1, prepare: false });
  try {
    return (await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.user_id = '${USER}'`);
      return fn(tx as unknown as Sql);
    })) as T;
  } finally {
    await sql.end();
  }
}

beforeAll(async () => {
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
  appUrl = u.toString();

  // Siembra como dueño: una fila en cada tabla nueva
  await owner`delete from public_jobs where external_id = ${EXTERNAL_ID}`;
  const [skill] = await owner<{ id: string }[]>`
    insert into skills (slug, name, category) values ('pool_rls_test', 'Pool RLS test', 'otra')
    on conflict (slug) do update set name = excluded.name returning id`;
  skillId = skill!.id;
  const [job] = await owner<{ id: string }[]>`
    insert into public_jobs (source_kind, external_id, source_name, source_url, title, title_normalized,
      company_raw, company_normalized, first_seen_at, last_seen_at)
    values ('remoteok', ${EXTERNAL_ID}, 'Remote OK', 'https://example.com/jobs/1', 'Backend Developer',
      'backend developer', 'Empresa Ficticia 1', 'empresa ficticia 1', now(), now())
    returning id`;
  publicJobId = job!.id;
  await owner`insert into public_job_skills (public_job_id, skill_id, is_must) values (${publicJobId}, ${skillId}, true)`;
  await owner`insert into role_market_snapshots (role, week_start, skill_id, mentions, must_mentions, jobs)
              values ('backend', '2026-10-05', ${skillId}, 3, 2, 3)`;
  await owner`insert into public_job_fetches (source_kind, started_at, status) values ('remoteok', now(), 'ok')`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from public_job_fetches where source_kind = 'remoteok'`;
    await owner`delete from role_market_snapshots where role = 'backend' and skill_id = ${skillId}`;
    await owner`delete from public_jobs where external_id = ${EXTERNAL_ID}`; // cascada a public_job_skills
    await owner`delete from skills where slug = 'pool_rls_test'`;
    await owner.end();
  }
  await container?.stop();
});

describe("RLS del pool global (ADR-014)", () => {
  it("jobsearch_app lee public_jobs, public_job_skills y role_market_snapshots", async () => {
    const [jobs] = await asApp(
      (tx) => tx`select count(*)::int as n from public_jobs where external_id = ${EXTERNAL_ID}`,
    );
    const [skillsRows] = await asApp(
      (tx) =>
        tx`select count(*)::int as n from public_job_skills where public_job_id = ${publicJobId}`,
    );
    const [snapshots] = await asApp(
      (tx) => tx`select count(*)::int as n from role_market_snapshots where skill_id = ${skillId}`,
    );
    expect(jobs!.n).toBe(1);
    expect(skillsRows!.n).toBe(1);
    expect(snapshots!.n).toBe(1);
  });

  it("INSERT en public_jobs falla para la app", async () => {
    await expect(
      asApp(
        (
          tx,
        ) => tx`insert into public_jobs (source_kind, external_id, source_name, source_url, title,
          title_normalized, company_raw, company_normalized, first_seen_at, last_seen_at)
          values ('remoteok', 'pool-rls-test-2', 'Remote OK', 'https://example.com/jobs/2', 'Otro',
          'otro', 'Empresa Ficticia 2', 'empresa ficticia 2', now(), now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("UPDATE y DELETE sobre public_jobs afectan 0 filas y la fila queda igual", async () => {
    const updated = await asApp(
      (tx) => tx`update public_jobs set title = 'hack' where external_id = ${EXTERNAL_ID}`,
    );
    const deleted = await asApp(
      (tx) => tx`delete from public_jobs where external_id = ${EXTERNAL_ID}`,
    );
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const [row] = await owner`select title from public_jobs where id = ${publicJobId}`;
    expect(row!.title).toBe("Backend Developer");
  });

  it("public_job_fetches devuelve 0 filas para la app aunque haya una", async () => {
    const [seen] = await asApp((tx) => tx`select count(*)::int as n from public_job_fetches`);
    expect(seen!.n).toBe(0);
  });

  it("control negativo: el dueño sí ve la fila de public_job_fetches", async () => {
    const [seen] = await owner`select count(*)::int as n from public_job_fetches`;
    expect(seen!.n).toBeGreaterThan(0);
  });
});
