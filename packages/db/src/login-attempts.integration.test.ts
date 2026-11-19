import { createHash, createHmac } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "./client";
import { applyMigrations } from "./migrate";

const holder = vi.hoisted(() => ({ db: undefined as unknown }));

// Los cachés de Next no existen fuera de un pedido.
vi.mock("../../../apps/web/lib/market", () => ({ invalidateMarketCandidates: () => undefined }));
vi.mock("../../../apps/web/lib/insights-cache", () => ({
  invalidateUserInsights: () => undefined,
}));

// deleteAccount importa ./db de la app: acá se reemplaza por la misma lógica de withUser sobre esta base.
vi.mock("../../../apps/web/lib/db", () => ({
  withUser: async (userId: string, fn: (tx: unknown) => Promise<unknown>) => {
    const db = holder.db as {
      transaction: (
        f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<unknown>,
      ) => Promise<unknown>;
    };
    const { sql: dsql } = await import("drizzle-orm");
    return db.transaction(async (tx) => {
      await tx.execute(dsql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  },
}));

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

const IP_1 = sha("ip:203.0.113.1");
const IP_2 = sha("ip:203.0.113.2");

async function begin(hash: string, ip: string | null = null): Promise<boolean> {
  const [row] = await app<
    { allowed: boolean }[]
  >`select login_attempt_begin(${hash}, ${ip}) as allowed`;
  return row!.allowed;
}

/** Clave de la fila por email + IP (la que lleva el tope de 5). Sin IP: la fila fija. */
function ipKey(hash: string, ip: string | null = null): string {
  return hash.slice(0, 32) + sha(`${hash}:${ip ?? "-"}`).slice(0, 32);
}

async function clear(hash: string): Promise<void> {
  await app`select login_attempt_clear(${hash})`;
}

/** Segundos que faltan para que venza el bloqueo de ese email. */
async function lockSeconds(hash: string, ip: string | null = null): Promise<number> {
  const [row] = await owner<{ s: number }[]>`
    select extract(epoch from locked_until - now())::float8 as s
      from login_attempts where email_hash = ${ipKey(hash, ip)}`;
  return row!.s;
}

async function expireLock(hash: string, ip: string | null = null): Promise<void> {
  await owner`update login_attempts set locked_until = now() - interval '1 second'
               where email_hash = ${ipKey(hash, ip)}`;
}

/** Borra todas las filas de esos emails (la por email y las por IP). */
async function wipe(...hashes: string[]): Promise<void> {
  const prefixes = hashes.map((h) => h.slice(0, 32));
  await owner`delete from login_attempts where left(email_hash, 32) in ${owner(prefixes)}`;
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
  holder.db = createDb(u.toString(), { max: 2 }).db;
}, 180_000);

beforeEach(async () => {
  await wipe(HASH_A, HASH_B);
});

afterAll(async () => {
  await wipe(HASH_A, HASH_B).catch(() => undefined);
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
                 where email_hash = ${ipKey(HASH_A)}`;

    expect(await begin(HASH_A)).toBe(true);

    const [row] = await owner<{ failed_count: number; locked_until: Date | null }[]>`
      select failed_count, locked_until from login_attempts where email_hash = ${ipKey(HASH_A)}`;
    expect(row).toEqual({ failed_count: 1, locked_until: null });
  });

  it("rechaza un hash con otro formato sin crear la fila", async () => {
    expect(await begin("persona@example.com")).toBe(false);

    const rows = await owner`select 1 from login_attempts where email_hash = 'persona@example.com'`;
    expect(rows).toHaveLength(0);
  });
});

describe("intentos por email y por IP", () => {
  it("los fallos desde otra IP no frenan a la persona en su IP", async () => {
    for (let i = 1; i <= 5; i += 1) expect(await begin(HASH_A, IP_2), `intento ${i}`).toBe(true);
    expect(await begin(HASH_A, IP_2)).toBe(false);

    expect(await begin(HASH_A, IP_1)).toBe(true);
  });

  it("el tope por email solo frena una ráfaga repartida en muchas IP", async () => {
    for (let i = 1; i <= 50; i += 1) {
      expect(await begin(HASH_A, sha(`ip:198.51.100.${i}`)), `intento ${i}`).toBe(true);
    }

    expect(await begin(HASH_A, sha("ip:198.51.100.200"))).toBe(false);
    expect(await begin(HASH_A, IP_1)).toBe(false);
    expect(await begin(HASH_B, IP_1)).toBe(true);
  });

  it("rechaza un hash de IP con otro formato", async () => {
    expect(await begin(HASH_A, "203.0.113.1")).toBe(false);
  });

  it("sin IP los intentos caen en una fila fija y siguen limitados a 5", async () => {
    for (let i = 1; i <= 5; i += 1) expect(await begin(HASH_A, null)).toBe(true);

    expect(await begin(HASH_A, null)).toBe(false);
  });
});

describe("login_attempt_clear", () => {
  it("con la cuenta en espera, limpiar (reset o login) permite entrar enseguida desde cualquier IP", async () => {
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A, IP_1);
    for (let i = 1; i <= 5; i += 1) await begin(HASH_A, IP_2);
    expect(await begin(HASH_A, IP_1)).toBe(false);
    expect(await begin(HASH_A, IP_2)).toBe(false);

    await clear(HASH_A);

    expect(await begin(HASH_A, IP_1)).toBe(true);
    expect(await begin(HASH_A, IP_2)).toBe(true);
  });

  it("no toca las filas de otro email", async () => {
    await begin(HASH_B, IP_1);

    await clear(HASH_A);

    const rows =
      await owner`select 1 from login_attempts where left(email_hash, 32) = ${HASH_B.slice(0, 32)}`;
    expect(rows).toHaveLength(2);
  });

  it("limpiar con un hash mal formado no borra nada", async () => {
    await begin(HASH_A, IP_1);

    await clear("%");

    const rows =
      await owner`select 1 from login_attempts where left(email_hash, 32) = ${HASH_A.slice(0, 32)}`;
    expect(rows).toHaveLength(2);
  });
});

describe("purga fuera del login", () => {
  it("pedir un intento ya no purga filas ajenas: la purga es del cron de retención", async () => {
    const STALE = sha("intentos-vencido@example.com");
    await owner`insert into login_attempts (email_hash, last_attempt_at)
                values (${STALE}, now() - interval '3 days')`;
    try {
      // La purga anterior corría en el 1 % de los pedidos: con mil, casi seguro habría borrado la fila.
      for (let i = 0; i < 1000; i += 1) await begin(HASH_A, IP_1);

      const rows = await owner`select 1 from login_attempts where email_hash = ${STALE}`;
      expect(rows).toHaveLength(1);
    } finally {
      await owner`delete from login_attempts where email_hash = ${STALE}`;
    }
  }, 60_000);
});

describe("borrado de cuenta", () => {
  const USER = "a9400000-0000-4000-8000-000000000001";
  const EMAIL = "borrar-cuenta@example.com";
  const PASSWORD = "clave-de-prueba-1234";

  it("al borrar la cuenta no quedan filas de su email, de ninguna IP ni con ningún hash", async () => {
    const { hashPassword } = await import("./password");
    await owner`insert into users (id, email, password_hash)
                values (${USER}, ${EMAIL}, ${hashPassword(PASSWORD)})`;
    const hashes = [
      sha(EMAIL),
      createHmac("sha256", "secreto-de-prueba").update(EMAIL).digest("hex"),
    ];
    for (const h of hashes) {
      await begin(h, IP_1);
      await begin(h, IP_2);
    }
    await begin(HASH_B, IP_1);
    vi.stubEnv("LOGIN_ATTEMPTS_HMAC_SECRET", "secreto-de-prueba");
    try {
      const { deleteAccount } = await import("../../../apps/web/lib/delete-account");

      const result = await deleteAccount(USER, { email: EMAIL, password: PASSWORD });

      expect(result.ok).toBe(true);
      for (const h of hashes) {
        const rows =
          await owner`select 1 from login_attempts where left(email_hash, 32) = ${h.slice(0, 32)}`;
        expect(rows, h).toHaveLength(0);
      }
      const others =
        await owner`select 1 from login_attempts where left(email_hash, 32) = ${HASH_B.slice(0, 32)}`;
      expect(others).toHaveLength(2);
    } finally {
      vi.unstubAllEnvs();
      await owner`delete from users where id = ${USER}`;
    }
  }, 60_000);
});

describe("rendimiento de login_attempts", () => {
  it("con miles de filas, borrar por email y purgar por fecha usan índice", async () => {
    await owner`insert into login_attempts (email_hash, last_attempt_at)
                select md5(i::text) || md5((i + 1)::text), now() - (i % 3) * interval '1 day'
                  from generate_series(1, 20000) as i`;
    try {
      await owner`analyze login_attempts`;
      const prefix = HASH_A.slice(0, 32);
      const plans = [
        await owner`explain delete from login_attempts where left(email_hash, 32) = ${prefix}`,
        await owner`explain delete from login_attempts where email_hash = ${HASH_A}`,
        await owner`explain delete from login_attempts where last_attempt_at < now() - interval '3 days'`,
        // La forma por lotes que usa la purga del cron.
        await owner`explain delete from login_attempts where email_hash in (
                      select email_hash from login_attempts
                       where last_attempt_at < now() - interval '3 days' limit 5000)`,
      ].map((rows) => rows.map((r) => String(r["QUERY PLAN"])).join("\n"));

      for (const plan of plans) expect(plan).not.toContain("Seq Scan");
    } finally {
      await owner`delete from login_attempts
                   where email_hash in (select md5(i::text) || md5((i + 1)::text)
                                          from generate_series(1, 20000) as i)`;
    }
  });
});

describe("login_attempt_clear (compatibilidad)", () => {
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
