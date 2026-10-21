import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Migración generada de la ronda 106 (ADR-021): el check de `waitlist` acepta `data_engineer` y
 * `solutions_engineer`, sin perder las claves anteriores. Es solo esquema (no hay backfill: las
 * carreras nuevas no reemplazan ninguna clave). Todo inventado.
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const EMAIL_LIKE = "%@tech-106.example.com";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function clean() {
  await owner`delete from waitlist where email like ${EMAIL_LIKE}`;
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
  owner = postgres(ownerUrl, { max: 2, prepare: false });
}, 180_000);

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await clean().catch(() => {});
  await owner?.end();
  await container?.stop();
});

describe("ronda 106: el check de la lista de espera", () => {
  const join = (n: number, role: string) =>
    owner`insert into waitlist (email, name, role)
      values (${`p${n}@tech-106.example.com`}, 'Persona Ficticia', ${role})`;

  it("acepta las dos carreras nuevas, las anteriores y la clave vieja; rechaza una desconocida", async () => {
    const roles = [
      "data_engineer",
      "solutions_engineer",
      "backend",
      "product_manager",
      "product_marketing",
      "producto_proyectos",
    ];
    for (const [i, role] of roles.entries()) await join(i, role);
    await expect(join(20, "engineering_manager")).rejects.toThrow(/waitlist_role_check/);
    await expect(join(21, "inventada")).rejects.toThrow(/waitlist_role_check/);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from waitlist where email like ${EMAIL_LIKE}`;
    expect(row!.n).toBe(roles.length);
  });
});
