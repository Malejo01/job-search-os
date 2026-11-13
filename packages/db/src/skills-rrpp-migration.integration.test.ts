import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import skills from "../seeds/skills.json";
import { applyMigrations } from "./migrate";

/**
 * Migración de datos de R6-5: da de alta las skills de relaciones públicas con las mismas filas que
 * seeds/skills.json, de forma idempotente. Mismos entornos que rls.integration.test.ts (CI:
 * DATABASE_URL; local: Testcontainer).
 */
const NEW_SLUGS = [
  "crisis_management",
  "event_management",
  "protocol_etiquette",
  "influencer_relations",
];
const DRIZZLE_DIR = join(__dirname, "../drizzle");
const migrationFile = readdirSync(DRIZZLE_DIR).find((f) =>
  /^\d{4}_skills_relaciones_publicas\.sql$/.test(f),
);

let container: StartedPostgreSqlContainer | null = null;
let ownerUrl: string;
let owner: Sql;

type Row = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  closure_hours: number;
  description: string;
  is_global: boolean;
};
const fetchRows = () =>
  owner<
    Row[]
  >`select slug, name, category, aliases, closure_hours, description, is_global from skills where slug = any(${NEW_SLUGS}) order by slug`;

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
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("R6-5: skills de relaciones públicas", () => {
  it("existe la migración de datos skills_relaciones_publicas", () => {
    expect(migrationFile, "falta drizzle/NNNN_skills_relaciones_publicas.sql").toBeDefined();
  });

  it("las 4 quedan en la base con las mismas filas que el seed", async () => {
    const rows = await fetchRows();
    expect(rows.map((r) => r.slug)).toEqual([...NEW_SLUGS].sort());
    for (const row of rows) {
      const seed = skills.find((s) => s.slug === row.slug)!;
      expect(row.name).toBe(seed.name);
      expect(row.category).toBe(seed.category);
      expect(row.aliases).toEqual(seed.aliases);
      expect(row.closure_hours).toBe(seed.closure_hours);
      expect(row.description).toBe(seed.description);
      expect(row.is_global).toBe(true);
    }
  });

  it("es idempotente: aplicarla de nuevo da lo mismo", async () => {
    const before = await fetchRows();
    const sqlText = readFileSync(join(DRIZZLE_DIR, migrationFile!), "utf8");
    await owner.unsafe(sqlText);
    await owner.unsafe(sqlText);
    await applyMigrations(ownerUrl, { log: () => {} });
    expect(await fetchRows()).toEqual(before);
  });
});
