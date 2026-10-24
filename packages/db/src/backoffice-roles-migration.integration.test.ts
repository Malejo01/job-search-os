import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import skills from "../seeds/skills.json";
import { applyMigrations } from "./migrate";

/**
 * Migraciones de la ronda C-2b: el check de `waitlist` acepta `finanzas_contabilidad` y
 * `asistencia_operaciones` (0043), y la migración de datos (0044) da de alta las ocho skills nuevas
 * y saca payroll/nómina de hr_generalist, de forma idempotente. Todo inventado.
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const EMAIL_LIKE = "%@backoffice-c2b.example.com";
const NEW_SLUGS = [
  "general_accounting",
  "financial_reporting",
  "erp_accounting",
  "tax_compliance",
  "payroll",
  "calendar_inbox",
  "office_suite",
  "data_entry",
];

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

describe("ronda C-2b: el check de la lista de espera", () => {
  const join_ = (n: number, role: string) =>
    owner`insert into waitlist (email, name, role)
      values (${`p${n}@backoffice-c2b.example.com`}, 'Persona Ficticia', ${role})`;

  it("acepta las dos carreras nuevas y las anteriores; rechaza una inventada", async () => {
    const roles = [
      "finanzas_contabilidad",
      "asistencia_operaciones",
      "ventas_b2b",
      "atencion_cliente",
      "rrhh_it",
    ];
    for (const [i, role] of roles.entries()) await join_(i, role);
    await expect(join_(20, "finanzas")).rejects.toThrow(/waitlist_role_check/);
    await expect(join_(21, "inventada")).rejects.toThrow(/waitlist_role_check/);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from waitlist where email like ${EMAIL_LIKE}`;
    expect(row!.n).toBe(roles.length);
  });
});

describe("ronda C-2b: las ocho skills nuevas y hr_generalist", () => {
  type Row = {
    slug: string;
    name: string;
    category: string;
    aliases: string[];
    closure_hours: number;
    description: string;
    is_global: boolean;
  };
  const slugs = [...NEW_SLUGS, "hr_generalist"];
  const fetchRows = () =>
    owner<
      Row[]
    >`select slug, name, category, aliases, closure_hours, description, is_global from skills where slug = any(${slugs}) order by slug`;

  it("quedan en la base con las mismas filas que el seed", async () => {
    const rows = await fetchRows();
    expect(rows.map((r) => r.slug)).toEqual([...slugs].sort());
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

  it("hr_generalist ya no tiene payroll ni nómina; payroll sí los tiene", async () => {
    const [hr] = await owner<
      { aliases: string[] }[]
    >`select aliases from skills where slug = 'hr_generalist'`;
    for (const a of ["payroll", "nómina", "nomina"]) expect(hr!.aliases).not.toContain(a);
    const [pay] = await owner<
      { aliases: string[] }[]
    >`select aliases from skills where slug = 'payroll'`;
    for (const a of ["payroll", "nómina", "nomina"]) expect(pay!.aliases).toContain(a);
  });

  it("la 0044 es idempotente: aplicarla de nuevo da lo mismo", async () => {
    const before = await fetchRows();
    const sqlText = readFileSync(
      join(__dirname, "../drizzle/0044_carreras_finanzas_operaciones.sql"),
      "utf8",
    );
    await owner.unsafe(sqlText);
    await owner.unsafe(sqlText);
    await applyMigrations(ownerUrl, { log: () => {} });
    const after = await fetchRows();
    expect(after).toEqual(before);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from skills where slug = any(${slugs})`;
    expect(row!.n).toBe(slugs.length);
  });
});
