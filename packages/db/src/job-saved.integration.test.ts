import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * «Guardada» (R30-03, `jobs.saved_at`) por el camino real: la app como jobsearch_app, con el mismo
 * UPDATE que usa `setJobSaved` (apps/web/lib/job-saved.ts). Guardar no cambia el estado, conserva la
 * fecha original, y nadie guarda ni quita la oferta de otra persona. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const A = "c3000000-0000-4000-8000-000000000001";
const B = "c3000000-0000-4000-8000-000000000002";
const JOB_A = "c3000000-0000-4000-8000-0000000000a1";
const JOB_B = "c3000000-0000-4000-8000-0000000000b1";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

/** Misma sentencia que el drizzle de `setJobSaved`: filtra por id y user_id, y conserva la fecha. */
const setSaved = (userId: string, jobId: string, saved: boolean) =>
  asUser(userId, (tx) =>
    saved
      ? tx`update jobs set saved_at = coalesce(saved_at, now())
           where id = ${jobId} and user_id = ${userId} returning id`
      : tx`update jobs set saved_at = null where id = ${jobId} and user_id = ${userId} returning id`,
  );

const readAs = (userId: string, jobId: string) =>
  asUser(userId, (tx) => tx`select status, saved_at from jobs where id = ${jobId}`);

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
  for (const [id, email] of [
    [A, "a@guardada.test"],
    [B, "b@guardada.test"],
  ] as const) {
    await owner`insert into users (id, email, name) values (${id}, ${email}, 'Ficticio')
      on conflict (id) do nothing`;
  }
  for (const [id, userId] of [
    [JOB_A, A],
    [JOB_B, B],
  ] as const) {
    await owner`insert into jobs (id, user_id, company_raw, title, title_normalized)
      values (${id}, ${userId}, 'Empresa A', 'Puesto Ficticio', 'puesto ficticio')
      on conflict (id) do nothing`;
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from jobs where id in ${owner([JOB_A, JOB_B])}`;
    await owner`delete from users where id in ${owner([A, B])}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("jobs.saved_at (R30-03)", () => {
  it("una oferta nueva no está guardada", async () => {
    const [row] = await readAs(A, JOB_A);
    expect(row!.saved_at).toBeNull();
  });

  it("guardar pone la fecha y no cambia el estado", async () => {
    const before = await readAs(A, JOB_A);
    const out = await setSaved(A, JOB_A, true);
    expect(out).toHaveLength(1);
    const [row] = await readAs(A, JOB_A);
    expect(row!.saved_at).toBeInstanceOf(Date);
    expect(row!.status).toBe(before[0]!.status);
  });

  it("guardar de nuevo conserva la fecha original", async () => {
    const [first] = await readAs(A, JOB_A);
    await setSaved(A, JOB_A, true);
    const [again] = await readAs(A, JOB_A);
    expect((again!.saved_at as Date).getTime()).toBe((first!.saved_at as Date).getTime());
  });

  it("quitar de guardadas la deja en null", async () => {
    const out = await setSaved(A, JOB_A, false);
    expect(out).toHaveLength(1);
    const [row] = await readAs(A, JOB_A);
    expect(row!.saved_at).toBeNull();
  });

  it("nadie guarda ni quita la oferta de otra persona", async () => {
    const saveOther = await setSaved(A, JOB_B, true);
    expect(saveOther).toHaveLength(0);
    // ni siquiera sin el filtro de user_id: la RLS la deja fuera
    const raw = await asUser(A, (tx) => tx`update jobs set saved_at = now() where id = ${JOB_B}`);
    expect(raw.count).toBe(0);
    expect(await readAs(A, JOB_B)).toHaveLength(0);
    const [row] = await owner`select saved_at from jobs where id = ${JOB_B}`;
    expect(row!.saved_at).toBeNull();

    await setSaved(B, JOB_B, true);
    const unsaveOther = await setSaved(A, JOB_B, false);
    expect(unsaveOther).toHaveLength(0);
    const [kept] = await owner`select saved_at from jobs where id = ${JOB_B}`;
    expect(kept!.saved_at).toBeInstanceOf(Date);
  });
});
