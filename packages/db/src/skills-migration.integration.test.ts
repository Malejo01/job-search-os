import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Migración 0019 (ronda 40): alta de las 19 skills de carreras digitales y ajuste de aliases de
 * `salesforce` y `seo`. Es de datos: se prueba sobre la base migrada, sin seed. Mismos entornos que
 * rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

type SeedSkill = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  closure_hours: number;
};
const seed = JSON.parse(
  readFileSync(join(PKG_ROOT, "seeds", "skills.json"), "utf8"),
) as SeedSkill[];
const NEW_SLUGS = [
  "google_ads",
  "meta_ads",
  "ga4",
  "email_marketing",
  "copywriting",
  "social_media",
  "product_management",
  "scrum_agile",
  "jira",
  "roadmap",
  "product_discovery",
  "sourcing",
  "interviewing",
  "ats",
  "employer_branding",
  "linkedin_recruiter",
  "hubspot",
  "customer_onboarding",
  "churn_retention",
];
const migrationSql = readFileSync(join(PKG_ROOT, "drizzle", "0019_carreras_digitales.sql"), "utf8");
// La 0032 (ronda 78) vuelve a tocar aliases que la 0019 escribe (mailchimp sale de email_marketing)
const migration0032Sql = readFileSync(
  join(PKG_ROOT, "drizzle", "0032_onboarding_datos.sql"),
  "utf8",
);

// La 0034 (ronda 97) da de alta las 7 skills de las carreras de producto
const migration0034Sql = readFileSync(
  join(PKG_ROOT, "drizzle", "0034_carreras_producto.sql"),
  "utf8",
);
const R97_SLUGS = [
  "go_to_market",
  "positioning_messaging",
  "market_research",
  "user_stories",
  "project_planning",
  "risk_management",
  "pm_certifications",
];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function runMigration0034() {
  for (const statement of migration0034Sql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

async function readR97() {
  return owner<
    {
      slug: string;
      name: string;
      category: string;
      aliases: string[];
      closure_hours: number;
      description: string;
    }[]
  >`select slug, name, category::text as category, aliases, closure_hours, description
    from skills where slug = any(${R97_SLUGS}) order by slug`;
}

/** Corre la 0019 como lo hace el migrador: statement por statement. */
async function runMigration0019() {
  for (const statement of migrationSql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

/** La 0032, también idempotente: deja la base como la secuencia real de migraciones. */
async function runMigration0032() {
  for (const statement of migration0032Sql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

async function countSkills(where = "true"): Promise<number> {
  const rows = await owner.unsafe(`select count(*)::int as total from skills where ${where}`);
  return Number(rows[0]?.total);
}

async function readNew() {
  return owner<
    { slug: string; name: string; category: string; aliases: string[]; closure_hours: number }[]
  >`select slug, name, category::text as category, aliases, closure_hours
    from skills where slug = any(${NEW_SLUGS}) order by slug`;
}

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
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
  await owner?.end();
  await container?.stop();
});

describe("migración 0019 · carreras digitales", () => {
  it("después de migrar, sin seed, están las 19 skills tal cual skills.json", async () => {
    const rows = await readNew();
    expect(rows).toHaveLength(NEW_SLUGS.length);
    for (const row of rows) {
      const expected = seed.find((s) => s.slug === row.slug);
      expect(expected, row.slug).toBeDefined();
      expect(row, row.slug).toEqual({
        slug: expected!.slug,
        name: expected!.name,
        category: expected!.category,
        aliases: expected!.aliases,
        closure_hours: expected!.closure_hours,
      });
    }
  });

  it("los slugs de la prueba son exactamente los nuevos de skills.json que trae la 0019", () => {
    for (const slug of NEW_SLUGS)
      expect(
        seed.some((s) => s.slug === slug),
        slug,
      ).toBe(true);
  });

  it("correrla dos veces no duplica ni cambia nada", async () => {
    const before = await readNew();
    const totalBefore = await countSkills();
    await runMigration0019();
    await runMigration0019();
    // Reaplicar la 0019 sola revierte aliases que cambió una migración posterior: se corre la 0032
    await runMigration0032();
    expect(await readNew()).toEqual(before);
    expect(await countSkills()).toBe(totalBefore);
  });

  it("sin salesforce ni seo en la base, los UPDATE sobre 0 filas no fallan", async () => {
    // Una base con seed ya las tiene: ahí el caso no aplica
    if ((await countSkills("slug in ('salesforce', 'seo')")) !== 0) return;
    await expect(runMigration0019()).resolves.toBeUndefined();
  });

  it("si salesforce y seo existen con los aliases viejos, los deja como skills.json", async () => {
    const find = (slug: string) => seed.find((s) => s.slug === slug)!;
    try {
      await owner`insert into skills (slug, name, category, aliases, closure_hours) values
        ('salesforce', 'Salesforce / CRM', 'dominio', ${["apollo", "hubspot", "crm"]}, 16),
        ('seo', 'SEO técnico', 'dominio', ${["core web vitals", "gtm", "ga4"]}, 16)`;
      await runMigration0019();
      const rows = await owner<{ slug: string; aliases: string[] }[]>`
        select slug, aliases from skills where slug in ('salesforce', 'seo') order by slug`;
      expect(rows).toEqual([
        { slug: "salesforce", aliases: find("salesforce").aliases },
        { slug: "seo", aliases: find("seo").aliases },
      ]);
      expect(find("salesforce").aliases).not.toContain("hubspot");
      expect(find("seo").aliases).not.toContain("ga4");
    } finally {
      await owner`delete from skills where slug in ('salesforce', 'seo')`;
    }
  });
});

describe("migración 0034 · skills de las carreras de producto", () => {
  it("después de migrar, sin seed, están las 7 skills tal cual skills.json", async () => {
    const rows = await readR97();
    expect(rows).toHaveLength(R97_SLUGS.length);
    for (const row of rows) {
      const expected = seed.find((s) => s.slug === row.slug) as SeedSkill & { description: string };
      expect(expected, row.slug).toBeDefined();
      expect(row, row.slug).toEqual({
        slug: expected.slug,
        name: expected.name,
        category: expected.category,
        aliases: expected.aliases,
        closure_hours: expected.closure_hours,
        description: expected.description,
      });
    }
  });

  it("gtm queda solo en go_to_market: sale de los aliases de growth_marketing", async () => {
    const find = (slug: string) => seed.find((s) => s.slug === slug)!;
    expect(find("go_to_market").aliases).toContain("gtm");
    expect(find("growth_marketing").aliases).not.toContain("gtm");
    try {
      await owner`insert into skills (slug, name, category, aliases, closure_hours) values
        ('growth_marketing', 'Growth / marketing', 'dominio', ${["cro", "gtm", "growth"]}, 16)`;
      await runMigration0034();
      const [row] = await owner<
        { aliases: string[] }[]
      >`select aliases from skills where slug = 'growth_marketing'`;
      expect(row!.aliases).toEqual(find("growth_marketing").aliases);
      expect(row!.aliases).not.toContain("gtm");
      const gtm = await owner<
        { slug: string }[]
      >`select slug from skills where slug = any(${R97_SLUGS}) and 'gtm' = any(aliases)`;
      expect(gtm.map((r) => r.slug)).toEqual(["go_to_market"]);
    } finally {
      await owner`delete from skills where slug = 'growth_marketing'`;
    }
  });

  it("correrla dos veces no duplica ni cambia nada", async () => {
    const before = await readR97();
    const totalBefore = await countSkills();
    await runMigration0034();
    await runMigration0034();
    expect(await readR97()).toEqual(before);
    expect(await countSkills()).toBe(totalBefore);
  });
});
