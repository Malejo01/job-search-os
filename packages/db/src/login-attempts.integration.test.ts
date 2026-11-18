import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Intentos de login por email, por el camino real: la app se conecta como jobsearch_app (NOBYPASSRLS)
 * y solo llega a la tabla por las funciones. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HASH_A = sha("intentos-a@example.com");
const HASH_B = sha("intentos-b@example.com");

let container: StartedPostgreSqlContainer | undefined;
let owner: Sql;
let app: Sql;

async function begin(hash: string): Promise<boolean> {
  const [row] = await app<{ allowed: boolean }[]>`select login_attempt_begin(${hash}) as allowed`;
  return row!.allowed;
}

async function clear(hash: string): Promise<void> {
  await app`select login_attempt_clear(${hash})`;
}

/** Segundos que faltan para que venza el bloqueo de ese email. */
async function lockSeconds(hash: string): Promise<number> {
  const [row] = await owner<{ s: number }[]>`
    select extract(epoch from locked_until - now())::float8 as s
      from login_attempts where email_hash = ${hash}`;
  return row!.s;
}

async function expireLock(hash: string): Promise<void> {
  await owner`update login_attempts set locked_until = now() - interval '1 second' where email_hash = ${hash}`;
}

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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 10, prepare: false });
}, 180_000);

beforeEach(async () => {
  await owner`delete from login_attempts where email_hash in ${owner([HASH_A, HASH_B])}`;
});

afterAll(async () => {
  if (owner) await owner`delete from login_attempts where email_hash in ${owner([HASH_A, HASH_B])}`;
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("login_attempt_begin", () => {
  it("permite 5 intentos y rechaza el siguiente, sin afectar a otro email", async () => {
    for (let i = 1; i <= 5; i += 1) expect(await begin(HASH_A), `intento ${i}`).toBe(true);

    expect(await begin(HASH_A)).toBe(false);
    expect(await begin(HASH_B)).toBe(true);
  });

  it("un intento rechazado no alarga el bloqueo", async () => {
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A);
    const before = await lockSeconds(HASH_A);

    await begin(HASH_A);

    expect(await lockSeconds(HASH_A)).toBeLessThanOrEqual(before);
  });

  it("20 intentos en paralelo: solo pasan 5", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => begin(HASH_A)));

    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("la espera crece con cada fallo y no pasa de 15 minutos", async () => {
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A);
    const first = await lockSeconds(HASH_A);
    expect(first).toBeGreaterThan(50);
    expect(first).toBeLessThanOrEqual(60);

    await expireLock(HASH_A);
    expect(await begin(HASH_A)).toBe(true);
    const second = await lockSeconds(HASH_A);
    expect(second).toBeGreaterThan(110);
    expect(second).toBeLessThanOrEqual(120);

    for (let i = 0; i < 12; i += 1) {
      await expireLock(HASH_A);
      await begin(HASH_A);
    }
    const capped = await lockSeconds(HASH_A);
    expect(capped).toBeGreaterThan(14 * 60);
    expect(capped).toBeLessThanOrEqual(15 * 60);
  });

  it("después de una hora sin intentos la cuenta vuelve a empezar", async () => {
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A);
    await owner`update login_attempts
                   set locked_until = now() - interval '1 minute',
                       last_attempt_at = now() - interval '61 minutes'
                 where email_hash = ${HASH_A}`;

    expect(await begin(HASH_A)).toBe(true);

    const [row] = await owner<{ failed_count: number; locked_until: Date | null }[]>`
      select failed_count, locked_until from login_attempts where email_hash = ${HASH_A}`;
    expect(row).toEqual({ failed_count: 1, locked_until: null });
  });

  it("rechaza un hash con otro formato sin crear la fila", async () => {
    expect(await begin("persona@example.com")).toBe(false);

    const rows = await owner`select 1 from login_attempts where email_hash = 'persona@example.com'`;
    expect(rows).toHaveLength(0);
  });
});

describe("login_attempt_clear", () => {
  it("un login correcto borra los intentos de ese email y no los de otro", async () => {
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A);
    await begin(HASH_B);

    await clear(HASH_A);

    expect(await begin(HASH_A)).toBe(true);
    const rows = await owner`select 1 from login_attempts where email_hash = ${HASH_B}`;
    expect(rows).toHaveLength(1);
  });
});

describe("acceso a login_attempts", () => {
  it("tiene RLS con FORCE", async () => {
    const [row] = await owner<{ rls: boolean; force: boolean }[]>`
      select relrowsecurity as rls, relforcerowsecurity as force
        from pg_class where relname = 'login_attempts'`;
    expect(row).toEqual({ rls: true, force: true });
  });

  it("el rol de la app no lee, no escribe ni borra la tabla directamente", async () => {
    await begin(HASH_A);

    expect(await app`select * from login_attempts`).toHaveLength(0);
    await expect(app`insert into login_attempts (email_hash) values (${HASH_B})`).rejects.toThrow();
    expect((await app`delete from login_attempts where email_hash = ${HASH_A}`).count).toBe(0);
    expect(
      (await app`update login_attempts set failed_count = 0 where email_hash = ${HASH_A}`).count,
    ).toBe(0);
  });
});
