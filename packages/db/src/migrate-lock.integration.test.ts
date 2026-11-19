import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, applyRlsFiles } from "./migrate";

/**
 * Las policies se aplican en una transacción que toma locks exclusivos. Si otra conexión retiene la tabla, la
 * aplicación tiene que rendirse con un error claro (lock_timeout), reintentar y no dejar nada a medias.
 * Datos inventados; las tablas son de prueba.
 */
let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let holder: Sql;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Dos archivos: el primero crea una tabla marca; el segundo necesita un lock exclusivo sobre la tabla retenida. */
function writeRlsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rls-lock-"));
  writeFileSync(
    join(dir, "0001_marca.sql"),
    "CREATE TABLE IF NOT EXISTS rls_lock_marca (id int primary key);",
  );
  writeFileSync(
    join(dir, "0002_policy.sql"),
    [
      "ALTER TABLE rls_lock_retenida ENABLE ROW LEVEL SECURITY;",
      "DROP POLICY IF EXISTS rls_lock_p ON rls_lock_retenida;",
      "CREATE POLICY rls_lock_p ON rls_lock_retenida USING (true);",
    ].join("\n"),
  );
  return dir;
}

const marcaExiste = async () =>
  (await owner`select 1 from pg_class where relname = 'rls_lock_marca'`).length > 0;

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
  holder = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe("CREATE TABLE IF NOT EXISTS rls_lock_retenida (id int primary key)");
}, 180_000);

afterAll(async () => {
  await owner?.unsafe("DROP TABLE IF EXISTS rls_lock_marca, rls_lock_retenida");
  await holder?.end();
  await owner?.end();
  await container?.stop();
});

/** Retiene la tabla en otra conexión hasta que se llame a `release`. */
async function holdTable(): Promise<{ release: () => Promise<void> }> {
  let release!: () => Promise<void>;
  const locked = new Promise<void>((resolveLocked) => {
    const done = new Promise<void>((resolveDone) => {
      release = async () => resolveDone();
    });
    void holder
      .begin(async (tx) => {
        await tx.unsafe("LOCK TABLE rls_lock_retenida IN ACCESS SHARE MODE");
        resolveLocked();
        await done;
      })
      .catch(() => {});
  });
  await locked;
  return { release };
}

describe("applyRlsFiles con una tabla retenida por otra conexión", () => {
  it("se rinde con un error claro y no deja nada aplicado", async () => {
    const dir = writeRlsDir();
    const held = await holdTable();
    // Red de seguridad del propio test: si la aplicación espera sin límite, el lock se suelta a los 8 s para que
    // el test falle limpio (la aplicación termina bien y no se rindió) en vez de colgar la conexión.
    const safety = setTimeout(() => void held.release(), 8000);
    try {
      const started = Date.now();
      await expect(
        applyRlsFiles(owner, dir, () => {}, { lockTimeoutMs: 200, backoffMs: [50, 50] }),
      ).rejects.toThrow(/lock|bloque|retenid/i);
      // 3 intentos de ~200 ms más 2 esperas de 50 ms: lejos de esperar indefinidamente
      expect(Date.now() - started).toBeLessThan(5000);
      expect(await marcaExiste()).toBe(false);
      const policies = await owner`select 1 from pg_policies where policyname = 'rls_lock_p'`;
      expect(policies).toHaveLength(0);
    } finally {
      clearTimeout(safety);
      await held.release();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);

  it("reintenta y termina bien cuando se suelta el lock", async () => {
    const dir = writeRlsDir();
    const held = await holdTable();
    const messages: string[] = [];
    try {
      const applying = applyRlsFiles(owner, dir, (m) => messages.push(m), {
        lockTimeoutMs: 300,
        backoffMs: [200, 400, 800],
      });
      await sleep(1000);
      await held.release();
      await applying;
      expect(messages.some((m) => /reintent/i.test(m))).toBe(true);
      expect(await marcaExiste()).toBe(true);
      const policies = await owner`select 1 from pg_policies where policyname = 'rls_lock_p'`;
      expect(policies).toHaveLength(1);
    } finally {
      await held.release();
      rmSync(dir, { recursive: true, force: true });
      await owner.unsafe("DROP TABLE IF EXISTS rls_lock_marca");
    }
  }, 20_000);

  it("un error que no es de lock no se reintenta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rls-lock-"));
    try {
      writeFileSync(join(dir, "0001_falla.sql"), "SELECT * FROM tabla_que_no_existe;");
      const messages: string[] = [];
      await expect(
        applyRlsFiles(owner, dir, (m) => messages.push(m), { lockTimeoutMs: 200, backoffMs: [50] }),
      ).rejects.toThrow(/tabla_que_no_existe/);
      expect(messages.some((m) => /reintent/i.test(m))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
