import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations, applyRlsFiles } from "./migrate";

/** Permisos de las tablas nuevas y aplicación de las policies en un solo paso. Datos inventados. */
let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

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
}, 180_000);

afterAll(async () => {
  await owner?.unsafe("DROP TABLE IF EXISTS tabla_nueva_prueba, rls_prueba_uno");
  await owner?.end();
  await container?.stop();
});

describe("permisos de una tabla nueva", () => {
  it("la app no tiene acceso hasta que una policy lo habilite", async () => {
    await owner.unsafe("CREATE TABLE tabla_nueva_prueba (id int primary key)");
    const [row] = await owner<{ ok: boolean }[]>`
      select has_table_privilege('jobsearch_app', 'tabla_nueva_prueba', 'SELECT')
          or has_table_privilege('jobsearch_app', 'tabla_nueva_prueba', 'INSERT') as ok`;
    expect(row!.ok).toBe(false);
  });

  it("las tablas existentes conservan sus permisos", async () => {
    const [row] = await owner<{ ok: boolean }[]>`
      select has_table_privilege('jobsearch_app', 'jobs', 'SELECT') as ok`;
    expect(row!.ok).toBe(true);
  });
});

describe("applyRlsFiles", () => {
  it("si un archivo falla no queda aplicado ninguno", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rls-prueba-"));
    try {
      writeFileSync(join(dir, "0001_ok.sql"), "CREATE TABLE rls_prueba_uno (id int primary key);");
      writeFileSync(join(dir, "0002_falla.sql"), "SELECT * FROM tabla_que_no_existe;");
      await expect(applyRlsFiles(owner, dir, () => {})).rejects.toThrow(/tabla_que_no_existe/);
      const rows = await owner`select 1 from pg_class where relname = 'rls_prueba_uno'`;
      expect(rows).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("aplica los archivos en orden alfabético", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rls-prueba-"));
    try {
      writeFileSync(join(dir, "0002_b.sql"), "ALTER TABLE rls_prueba_uno ADD COLUMN nota text;");
      writeFileSync(join(dir, "0001_a.sql"), "CREATE TABLE rls_prueba_uno (id int primary key);");
      await applyRlsFiles(owner, dir, () => {});
      const rows = await owner`
        select 1 from information_schema.columns
         where table_name = 'rls_prueba_uno' and column_name = 'nota'`;
      expect(rows).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
