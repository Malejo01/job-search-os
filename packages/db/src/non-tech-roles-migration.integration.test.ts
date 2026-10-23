import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import skills from "../seeds/skills.json";
import { applyMigrations } from "./migrate";

/**
 * Migraciones de la ronda 107 (ADR-022): el check de `waitlist` acepta `ventas_b2b` y
 * `atencion_cliente` sin perder las claves anteriores, y la migración de datos da de alta las cinco
 * skills nuevas de forma idempotente (mismas filas que seeds/skills.json). Todo inventado.
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const EMAIL_LIKE = "%@non-tech-107.example.com";
const R107_SLUGS = ["prospecting", "negotiation", "sales_tools", "chat_support", "hr_generalist"];

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

describe("ronda 107: el check de la lista de espera", () => {
  const join = (n: number, role: string) =>
    owner`insert into waitlist (email, name, role)
      values (${`p${n}@non-tech-107.example.com`}, 'Persona Ficticia', ${role})`;

  it("acepta las dos carreras nuevas, las anteriores y la clave vieja; rechaza una desconocida", async () => {
    const roles = [
      "ventas_b2b",
      "atencion_cliente",
      "rrhh_it",
      "data_engineer",
      "solutions_engineer",
      "backend",
      "producto_proyectos",
    ];
    for (const [i, role] of roles.entries()) await join(i, role);
    await expect(join(20, "ventas")).rejects.toThrow(/waitlist_role_check/);
    await expect(join(21, "inventada")).rejects.toThrow(/waitlist_role_check/);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from waitlist where email like ${EMAIL_LIKE}`;
    expect(row!.n).toBe(roles.length);
  });
});

describe("ronda 107: las cinco skills nuevas", () => {
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
    >`select slug, name, category, aliases, closure_hours, description, is_global from skills where slug = any(${R107_SLUGS}) order by slug`;

  it("quedan en la base con las mismas filas que el seed", async () => {
    const rows = await fetchRows();
    expect(rows.map((r) => r.slug)).toEqual([...R107_SLUGS].sort());
    for (const row of rows) {
      const seed = skills.find((s) => s.slug === row.slug)!;
      expect(row.name).toBe(seed.name);
      expect(row.category).toBe("dominio");
      expect(row.aliases).toEqual(seed.aliases); // incluye hr_generalist ya sin payroll (0044)
      expect(row.closure_hours).toBe(seed.closure_hours);
      expect(row.description).toBe(seed.description);
      expect(row.is_global).toBe(true);
    }
  });

  it("es idempotente: volver a correr las migraciones no duplica ni cambia nada", async () => {
    const before = await fetchRows();
    await applyMigrations(ownerUrl, { log: () => {} });
    const after = await fetchRows();
    expect(after).toEqual(before);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from skills where slug = any(${R107_SLUGS})`;
    expect(row!.n).toBe(R107_SLUGS.length);
  });
});
