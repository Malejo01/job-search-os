import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import roleSkills from "../seeds/role_skills.json";
import skills from "../seeds/skills.json";
import { applyMigrations } from "./migrate";

/**
 * Migraciones de C1-2 (ADR-027): el check de `waitlist` acepta las cuatro carreras de la beta
 * (0048) y la migración de datos (0049) da de alta las 30 skills nuevas, de forma idempotente. Todo
 * inventado. Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const EMAIL_LIKE = "%@carreras-beta.example.com";
const NEW_KEYS = [
  "abogacia",
  "administracion_empresas",
  "comunicacion",
  "relaciones_internacionales",
] as const;

// Las skills que solo usan las carreras nuevas y no existían antes de C1-2: las que no están en
// ninguna de las carreras anteriores.
const OLD_KEYS = Object.keys(roleSkills).filter(
  (k) => !(NEW_KEYS as readonly string[]).includes(k),
);
const OLD_SLUGS = new Set(
  OLD_KEYS.flatMap((k) => (roleSkills as Record<string, { skills: string[] }>)[k]!.skills),
);
const NEW_SLUGS = NEW_KEYS.flatMap(
  (k) => (roleSkills as Record<string, { skills: string[] }>)[k]!.skills,
).filter((s) => !OLD_SLUGS.has(s));

let container: StartedPostgreSqlContainer | null = null;
let ownerUrl: string;
let owner: Sql;

async function clean() {
  await owner`delete from waitlist where email like ${EMAIL_LIKE}`;
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
}, 180_000);

beforeEach(async () => {
  await clean();
});

afterAll(async () => {
  await clean().catch(() => {});
  await owner?.end();
  await container?.stop();
});

describe("C1-2: el check de la lista de espera", () => {
  const join_ = (n: number, role: string) =>
    owner`insert into waitlist (email, name, role)
      values (${`p${n}@carreras-beta.example.com`}, 'Persona Ficticia', ${role})`;

  it("acepta las cuatro carreras nuevas y las anteriores; rechaza una inventada", async () => {
    const roles = [...NEW_KEYS, "finanzas_contabilidad", "marketing_digital"];
    for (const [i, role] of roles.entries()) await join_(i, role);
    await expect(join_(20, "derecho")).rejects.toThrow(/waitlist_role_check/);
    await expect(join_(21, "inventada")).rejects.toThrow(/waitlist_role_check/);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from waitlist where email like ${EMAIL_LIKE}`;
    expect(row!.n).toBe(roles.length);
  });
});

describe("C1-2: las skills nuevas", () => {
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

  it("son 30 y quedan en la base con las mismas filas que el seed", async () => {
    expect(NEW_SLUGS).toHaveLength(30);
    const rows = await fetchRows();
    expect(rows.map((r) => r.slug)).toEqual([...NEW_SLUGS].sort());
    for (const row of rows) {
      const seed = skills.find((s) => s.slug === row.slug)!;
      expect(row.name).toBe(seed.name);
      expect(row.category).toBe("dominio");
      expect(row.aliases).toEqual(seed.aliases);
      expect(row.closure_hours).toBe(seed.closure_hours);
      expect(row.description).toBe(seed.description);
      expect(row.is_global).toBe(true);
    }
  });

  it("la 0049 es idempotente: aplicarla de nuevo da lo mismo", async () => {
    const before = await fetchRows();
    const sqlText = readFileSync(
      join(__dirname, "../drizzle/0049_carreras_beta_skills.sql"),
      "utf8",
    );
    await owner.unsafe(sqlText);
    await owner.unsafe(sqlText);
    await applyMigrations(ownerUrl, { log: () => {} });
    const after = await fetchRows();
    expect(after).toEqual(before);
  });
});
