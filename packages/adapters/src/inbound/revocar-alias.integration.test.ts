import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb } from "@job-search-os/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * La persona revoca la dirección anterior de una rotación desde la app (rol sin ownership ni BYPASSRLS,
 * con app.user_id por transacción). Solo toca su propio perfil; la app sigue sin poder escribir esas
 * columnas por su cuenta.
 */
const A = "a0000000-0000-4000-8000-0000000000f1";
const B = "a0000000-0000-4000-8000-0000000000f2";
const APP_PASSWORD = "jobsearch_app_test";
const OLD_A = "u_f1000000@ingest.test";
const OLD_B = "u_f2000000@ingest.test";

let container: StartedPostgreSqlContainer | null = null;
let owner: ReturnType<typeof createDb>;
let app: ReturnType<typeof createDb>;

type Row = Record<string, unknown>;

/** Una transacción como la app: con app.user_id de la persona (o sin sesión). */
async function asUser<T>(
  userId: string | null,
  fn: (run: (q: ReturnType<typeof sql>) => Promise<Row[]>) => Promise<T>,
) {
  return app.db.transaction(async (tx) => {
    if (userId) await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(async (q) => (await tx.execute(q)) as unknown as Row[]);
  });
}

const revoke = (userId: string | null) =>
  asUser(userId, async (run) => {
    const rows = await run(sql`select public.revoke_previous_inbound_address() as ok`);
    return rows[0]?.ok as boolean;
  });

const previousOf = async (userId: string) =>
  (
    (await owner.db.execute(
      sql`select previous_inbound_address, previous_inbound_until from profiles where user_id = ${userId}::uuid`,
    )) as unknown as Row[]
  )[0];

beforeAll(async () => {
  let ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = createDb(ownerUrl, { max: 1 });
  await owner.db.execute(sql.raw(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`));
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = createDb(u.toString(), { max: 1 });
  for (const [user, nuevo, viejo] of [
    [A, "u_aaaaaaaaaaaaaaaaaaaa@ingest.test", OLD_A],
    [B, "u_bbbbbbbbbbbbbbbbbbbb@ingest.test", OLD_B],
  ] as const) {
    await owner.db.execute(sql`
      insert into profiles (user_id, display_name, location_country, inbound_address, profile_summary,
                            previous_inbound_address, previous_inbound_until)
      values (${user}::uuid, 'Alias', 'AR', ${nuevo}, 'AI Engineer.', ${viejo}, now() + interval '5 days')
      on conflict (user_id) do nothing`);
  }
}, 180_000);

afterAll(async () => {
  await app?.close();
  await owner?.close();
  await container?.stop();
});

describe("revocar la dirección anterior", () => {
  it("la app no puede escribir esas columnas directamente", async () => {
    await expect(
      asUser(A, (run) =>
        run(sql`update profiles set previous_inbound_address = null where user_id = ${A}::uuid`),
      ),
    ).rejects.toThrow();
    expect((await previousOf(A))?.previous_inbound_address).toBe(OLD_A);
  });

  it("sin sesión no revoca nada", async () => {
    expect(await revoke(null)).toBe(false);
    expect((await previousOf(A))?.previous_inbound_address).toBe(OLD_A);
    expect((await previousOf(B))?.previous_inbound_address).toBe(OLD_B);
  });

  it("la persona revoca la suya y no toca la de otra", async () => {
    expect(await revoke(A)).toBe(true);
    // Repetirlo no falla ni cambia nada
    expect(await revoke(A)).toBe(false);

    expect(await previousOf(A)).toEqual({
      previous_inbound_address: null,
      previous_inbound_until: null,
    });
    expect((await previousOf(B))?.previous_inbound_address).toBe(OLD_B);
  });
});
