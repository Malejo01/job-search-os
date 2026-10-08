import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * JS-096 · Guardado de criterios por el camino real: la app como jobsearch_app, con app.user_id.
 * La lógica vive en apps/web/lib/criteria.ts (writeNextVersion); acá se reproducen sus sentencias
 * con el rol de la app. Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local:
 * Testcontainer).
 */
const USER_A = "bbbbbbbb-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

class SaveConflict extends Error {}

/** Mismas sentencias que writeNextVersion, dentro de una transacción con app.user_id. */
async function save(
  userId: string,
  rules: Record<string, unknown>,
  baseVersion?: number,
): Promise<{ ok: true; version: number } | { ok: false }> {
  try {
    const version = await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${userId}, true)`;
      const [latest] = await tx<{ max_version: number }[]>`
        select coalesce(max(version), 0)::int as max_version
        from evaluation_criteria where user_id = ${userId}`;
      const maxVersion = latest!.max_version;
      if (baseVersion !== undefined && baseVersion !== maxVersion) throw new SaveConflict();
      await tx`update evaluation_criteria set active = false
               where user_id = ${userId} and active = true`;
      const inserted = await tx`
        insert into evaluation_criteria (user_id, version, active, rules)
        values (${userId}, ${maxVersion + 1}, true, ${tx.json(rules as never)})
        on conflict do nothing returning version`;
      if (inserted.length === 0) throw new SaveConflict();
      return maxVersion + 1;
    });
    return { ok: true, version };
  } catch (error) {
    if (error instanceof SaveConflict) return { ok: false };
    throw error;
  }
}

/** Lo que lee la ingesta: la activa de mayor versión. */
async function readAs(userId: string) {
  return app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return tx<{ version: number; active: boolean; rules: { salary_floor_usd_monthly: number } }[]>`
      select version, active, rules from evaluation_criteria order by version`;
  });
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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 8, prepare: false });
  await owner`insert into users (id, email) values (${USER_A}, 'a@criterios.test'), (${USER_B}, 'b@criterios.test')`;
  await owner`insert into evaluation_criteria (user_id, version, active, rules) values
    (${USER_A}, 1, true, ${owner.json({ salary_floor_usd_monthly: 1000 })}),
    (${USER_B}, 1, true, ${owner.json({ salary_floor_usd_monthly: 2000 })})`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from evaluation_criteria where user_id in (${USER_A}, ${USER_B})`;
    await owner`delete from users where id in (${USER_A}, ${USER_B})`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("guardado de criterios (JS-096)", () => {
  it("A guarda y queda una sola versión activa, la N+1", async () => {
    const r = await save(USER_A, { salary_floor_usd_monthly: 1500 }, 1);
    expect(r).toEqual({ ok: true, version: 2 });
    const rows = await readAs(USER_A);
    expect(rows.map((x) => [x.version, x.active])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(rows.find((x) => x.active)?.rules.salary_floor_usd_monthly).toBe(1500);
  });

  it("A no ve ni modifica los criterios de B", async () => {
    // lo que ve A no incluye la fila de B
    const seen = await readAs(USER_A);
    expect(seen.some((x) => x.rules.salary_floor_usd_monthly === 2000)).toBe(false);

    // un UPDATE de A sobre filas de B no toca ninguna
    const touched = await app.begin(async (tx) => {
      await tx`select set_config('app.user_id', ${USER_A}, true)`;
      return tx`update evaluation_criteria set active = false where user_id = ${USER_B} returning id`;
    });
    expect(touched).toHaveLength(0);

    // un INSERT de A a nombre de B lo frena el WITH CHECK
    await expect(
      app.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${USER_A}, true)`;
        await tx`insert into evaluation_criteria (user_id, version, active, rules)
                 values (${USER_B}, 9, true, ${tx.json({ salary_floor_usd_monthly: 1 } as never)})`;
      }),
    ).rejects.toThrow();

    const [b] = await owner<{ n: number; active: number }[]>`
      select count(*)::int as n, count(*) filter (where active)::int as active
      from evaluation_criteria where user_id = ${USER_B}`;
    expect(b).toEqual({ n: 1, active: 1 });
  });

  it("dos guardados simultáneos dejan una sola versión nueva y una sola activa", async () => {
    const [before] = await owner<{ max: number }[]>`
      select max(version)::int as max from evaluation_criteria where user_id = ${USER_A}`;
    const results = await Promise.all([
      // los dos parten de la misma versión que vieron, como en el formulario real
      save(USER_A, { salary_floor_usd_monthly: 11 }, before!.max),
      save(USER_A, { salary_floor_usd_monthly: 22 }, before!.max),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);

    const [after] = await owner<{ max: number; n: number; active: number }[]>`
      select max(version)::int as max, count(*)::int as n,
             count(*) filter (where active)::int as active
      from evaluation_criteria where user_id = ${USER_A}`;
    expect(after!.max).toBe(before!.max + 1);
    expect(after!.active).toBe(1);
    // la activa es la de mayor versión (como la lee la ingesta)
    const [top] = await owner<{ version: number; active: boolean }[]>`
      select version, active from evaluation_criteria
      where user_id = ${USER_A} order by version desc limit 1`;
    expect(top).toEqual({ version: after!.max, active: true });
  });

  it("guardar sobre una versión vieja (baseVersion) es conflicto y no cambia nada", async () => {
    const [before] = await owner<{ max: number }[]>`
      select max(version)::int as max from evaluation_criteria where user_id = ${USER_A}`;
    const r = await save(USER_A, { salary_floor_usd_monthly: 99 }, 1);
    expect(r).toEqual({ ok: false });
    const [after] = await owner<{ max: number; active: number }[]>`
      select max(version)::int as max, count(*) filter (where active)::int as active
      from evaluation_criteria where user_id = ${USER_A}`;
    expect(after).toEqual({ max: before!.max, active: 1 });
  });
});
