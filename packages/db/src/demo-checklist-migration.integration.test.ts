import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Ronda 115: `demo_evaluations.checklist` (jsonb, nullable) guarda los requisitos del aviso de la
 * demo. Una columna nueva no cambia la policy: sigue habiendo un único SELECT público (rls/0007).
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
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
  owner = postgres(ownerUrl, { max: 2 });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("demo_evaluations.checklist", () => {
  it("es jsonb y admite null (las filas anteriores a la ronda 115 quedan sin checklist)", async () => {
    const cols = await owner<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'demo_evaluations' and column_name = 'checklist'`;
    expect(cols).toEqual([{ data_type: "jsonb", is_nullable: "YES" }]);
  });

  it("la tabla sigue con una sola policy, de SELECT", async () => {
    const policies = await owner<{ cmd: string }[]>`
      select cmd from pg_policies where tablename = 'demo_evaluations'`;
    expect(policies).toEqual([{ cmd: "SELECT" }]);
  });
});
