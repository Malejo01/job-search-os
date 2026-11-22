import { createHash } from "node:crypto";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Espera del login por email solo y orden de los locks, por el camino real: la app se conecta como
 * jobsearch_app y solo llega a la tabla por las funciones. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const HASH_A = sha("espera-a@example.com");
const HASH_B = sha("espera-b@example.com");
const IP_1 = sha("ip:203.0.113.1");
const ipN = (n: number) => sha(`ip:198.51.100.${n}`);

let container: StartedPostgreSqlContainer | undefined;
let ownerUrl: string;
let owner: Sql;
let app: Sql;

async function begin(hash: string, ip: string | null = null): Promise<boolean> {
  const [row] = await app<
    { allowed: boolean }[]
  >`select login_attempt_begin(${hash}, ${ip}) as allowed`;
  return row!.allowed;
}
const clear = async (hash: string) => {
  await app`select login_attempt_clear(${hash})`;
};
const ipKey = (hash: string, ip: string | null = null) =>
  hash.slice(0, 32) + sha(`${hash}:${ip ?? "-"}`).slice(0, 32);

/** Segundos que faltan para que venza el bloqueo de la fila por email solo (null: sin bloqueo). */
async function emailLockSeconds(hash: string): Promise<number | null> {
  const [row] = await owner<{ s: number | null }[]>`
    select extract(epoch from locked_until - now())::float8 as s
      from login_attempts where email_hash = ${hash}`;
  return row?.s ?? null;
}
const expireEmailLock = async (hash: string) => {
  await owner`update login_attempts set locked_until = now() - interval '1 second'
               where email_hash = ${hash}`;
};
async function wipe(...hashes: string[]): Promise<void> {
  const prefixes = hashes.map((h) => h.slice(0, 32));
  await owner`delete from login_attempts where left(email_hash, 32) in ${owner(prefixes)}`;
}
/** 10 IP con 5 intentos cada una: 50 fallos repartidos que activan el tope por email solo. */
async function lockWithTenIps(hash: string): Promise<void> {
  for (let ip = 1; ip <= 10; ip += 1) {
    for (let i = 1; i <= 5; i += 1)
      expect(await begin(hash, ipN(ip)), `ip ${ip} intento ${i}`).toBe(true);
  }
}

beforeAll(async () => {
  let url = process.env.DATABASE_URL;
  if (!url) {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    url = container.getConnectionUri();
  }
  ownerUrl = url;
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 2, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 10, prepare: false });
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

describe("espera por email solo (bloqueo sostenido)", () => {
  it("con 10 IP repartidas la cuenta queda en espera 1 minuto", async () => {
    await lockWithTenIps(HASH_A);

    expect(await begin(HASH_A, IP_1)).toBe(false);
    const s = await emailLockSeconds(HASH_A);
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(60);
  });

  it("el contador no vuelve a cero al vencer: la espera crece 1, 2, 4, 8 y 15 minutos como máximo", async () => {
    await lockWithTenIps(HASH_A);
    const maxes = [60, 120, 240, 480, 900, 900, 900];
    const mins = [0, 60, 120, 240, 480, 600, 600];

    for (let vuelta = 0; vuelta < maxes.length; vuelta += 1) {
      const s = await emailLockSeconds(HASH_A);
      expect(s, `vuelta ${vuelta}`).toBeGreaterThan(mins[vuelta]!);
      expect(s, `vuelta ${vuelta}`).toBeLessThanOrEqual(maxes[vuelta]!);
      await expireEmailLock(HASH_A);
      expect(await begin(HASH_A, ipN(100 + vuelta)), `vuelta ${vuelta}: pasa un intento`).toBe(
        true,
      );
    }
  });

  it("24 horas de intentos sostenidos repartidos en 10 IP: a lo sumo ~200 intentos evaluados y nunca más de 15 minutos seguidos", async () => {
    // Reloj simulado: cada minuto se corren hacia atrás los vencimientos y las marcas de la cuenta, y cada una
    // de las 10 IP intenta una vez.
    let evaluados = 0;
    let techoSeguido = 0;
    for (let minuto = 1; minuto <= 24 * 60; minuto += 1) {
      await owner`update login_attempts
                     set locked_until = locked_until - interval '1 minute',
                         last_attempt_at = last_attempt_at - interval '1 minute'
                   where left(email_hash, 32) = ${HASH_A.slice(0, 32)}`;
      for (let ip = 1; ip <= 10; ip += 1) if (await begin(HASH_A, ipN(ip))) evaluados += 1;
      techoSeguido = Math.max(techoSeguido, (await emailLockSeconds(HASH_A)) ?? 0);
    }

    expect(evaluados).toBeGreaterThan(50);
    // Medido: 148 (50 antes del primer bloqueo y uno por cada espera de 15 minutos)
    expect(evaluados, `evaluados=${evaluados}`).toBeLessThanOrEqual(200);
    expect(techoSeguido).toBeLessThanOrEqual(15 * 60);
  }, 180_000);

  it("restablecer la contraseña (login_attempt_clear) destraba enseguida desde cualquier IP", async () => {
    await lockWithTenIps(HASH_A);
    expect(await begin(HASH_A, IP_1)).toBe(false);

    await clear(HASH_A);

    expect(await begin(HASH_A, IP_1)).toBe(true);
    expect(await begin(HASH_A, ipN(1))).toBe(true);
    expect(await emailLockSeconds(HASH_A)).toBeNull();
  });

  it("no toca a otro email", async () => {
    await lockWithTenIps(HASH_A);

    expect(await begin(HASH_B, IP_1)).toBe(true);
  });
});

describe("orden de los locks: begin y clear toman primero la fila por email", () => {
  it("clear espera la fila por email sin haber tomado antes la de la IP", async () => {
    // La fila de la IP está primero en el disco: borrar por prefijo la alcanzaría antes que la del email.
    const ipRow = ipKey(HASH_A, IP_1);
    await owner`insert into login_attempts (email_hash) values (${ipRow})`;
    await owner`insert into login_attempts (email_hash) values (${HASH_A})`;
    const holder = postgres(ownerUrl, { max: 1, prepare: false });
    try {
      const outcome = await holder.begin(async (tx) => {
        await tx`select 1 from login_attempts where email_hash = ${HASH_A} for update`;
        const pending = app`select login_attempt_clear(${HASH_A})`.then(() => "listo");
        await new Promise((r) => setTimeout(r, 600));
        // Si clear ya hubiera tomado la fila de la IP, esta consulta falla por nowait (55P03)
        const ipState =
          await owner`select 1 from login_attempts where email_hash = ${ipRow} for update nowait`.then(
            () => "libre",
            (e: { code?: string }) => (e.code === "55P03" ? "tomada" : `error ${e.code}`),
          );
        return { pending, ipState };
      });
      expect(outcome.ipState).toBe("libre");
      await outcome.pending;
    } finally {
      await holder.end();
    }
    const rows =
      await owner`select 1 from login_attempts where left(email_hash, 32) = ${HASH_A.slice(0, 32)}`;
    expect(rows).toHaveLength(0);
  }, 30_000);

  it("begin y clear en paralelo sobre el mismo email no dan deadlock (lock_timeout de 5 s)", async () => {
    const worker = async (n: number) => {
      const results: unknown[] = [];
      for (let i = 0; i < 100; i += 1) {
        results.push(
          await app
            .begin(async (tx) => {
              await tx`set local lock_timeout = '5s'`;
              return i % 4 === 3
                ? tx`select login_attempt_clear(${HASH_A})`
                : tx`select login_attempt_begin(${HASH_A}, ${ipN((n * 7 + i) % 9)})`;
            })
            .catch((e: { message: string; detail?: string; where?: string }) => {
              throw new Error(`${e.message} · ${e.detail ?? ""} · ${e.where ?? ""}`);
            }),
        );
      }
      return results.length;
    };

    const done = await Promise.all(Array.from({ length: 12 }, (_, n) => worker(n)));

    expect(done).toEqual(Array.from({ length: 12 }, () => 100));
  }, 120_000);
});
