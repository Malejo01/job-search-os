import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Migraciones 0033 y 0034 (ronda 97, ADR-019): `producto_proyectos` se parte en `product_manager`,
 * `product_owner`, `project_manager` y `product_marketing`. La 0033 expande el check de `waitlist`
 * (esquema); la 0034 (de datos) migra `profiles.target_roles` / `target_role`, `jobs.matched_role` y
 * `waitlist.role`. Se aplican todas las migraciones y, para probar el backfill, el test deja filas con
 * la clave vieja y corre el SQL de la 0034 statement por statement, como el migrador. Todo inventado.
 * Mismos entornos que rls.integration.test.ts (CI: DATABASE_URL; local: Testcontainer).
 */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationSql = readFileSync(join(PKG_ROOT, "drizzle", "0034_carreras_producto.sql"), "utf8");

const LEGACY = "producto_proyectos";
const U = (n: number) => `a9700000-0000-4000-8000-00000000000${n}`;
const USERS = [U(1), U(2), U(3), U(4), U(5), U(6), U(7)];
const EMAIL_LIKE = "%@producto-97.example.com";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function runMigration() {
  for (const statement of migrationSql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

async function profileOf(userId: string) {
  const [row] = await owner<
    { target_role: string | null; target_roles: string[] }[]
  >`select target_role, target_roles from profiles where user_id = ${userId}`;
  return row!;
}

async function addProfile(
  n: number,
  headline: string | null,
  targetRoles: string[],
  targetRole: string | null = targetRoles[0] ?? null,
) {
  await owner`insert into profiles
    (user_id, display_name, headline, location_country, inbound_address, target_role, target_roles)
    values (${U(n)}, 'Test', ${headline}, 'AR', ${`u_a97_${n}@ingest.test`}, ${targetRole},
            ${targetRoles}::text[])`;
}

async function addJob(userId: string, n: number, matchedRole: string | null) {
  await owner`insert into jobs (user_id, company_raw, title, title_normalized, canonical_url, matched_role)
    values (${userId}, 'Empresa Ficticia A', 'Oferta ficticia', 'oferta ficticia',
            ${`https://example.com/jobs/a97-${n}`}, ${matchedRole})`;
}

async function matchedRoleOf(n: number) {
  const [row] = await owner<
    { matched_role: string | null }[]
  >`select matched_role from jobs where canonical_url = ${`https://example.com/jobs/a97-${n}`}`;
  return row!.matched_role;
}

async function clean() {
  await owner`delete from jobs where user_id = any(${USERS})`;
  await owner`delete from profiles where user_id = any(${USERS})`;
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

describe("0033: el check de la lista de espera", () => {
  const join = (n: number, role: string) =>
    owner`insert into waitlist (email, name, role)
      values (${`p${n}@producto-97.example.com`}, 'Persona Ficticia', ${role})`;

  it("acepta las 4 carreras nuevas, sigue aceptando la vieja y rechaza una desconocida", async () => {
    const roles = ["product_manager", "product_owner", "project_manager", "product_marketing"];
    for (const [i, role] of roles.entries()) await join(i, role);
    await join(10, LEGACY);
    await expect(join(11, "inventada")).rejects.toThrow(/waitlist_role_check/);
    const [row] = await owner<
      { n: number }[]
    >`select count(*)::int as n from waitlist where email like ${EMAIL_LIKE}`;
    expect(row!.n).toBe(5);
  });
});

describe("0034: backfill de carreras de producto", () => {
  it("la carrera sale del titular; el principal sigue siendo el primero", async () => {
    await addProfile(1, "Scrum Master", ["data_analyst", LEGACY]);
    await addProfile(2, "Product Owner / Scrum Master", [LEGACY]);
    await addProfile(3, "Dueña de Producto", [LEGACY, "qa"]);
    await addProfile(4, "Product Marketing Manager", [LEGACY]);
    await addProfile(5, "Jefa de Proyectos", [LEGACY]);
    await runMigration();
    expect(await profileOf(U(1))).toEqual({
      target_role: "data_analyst",
      target_roles: ["data_analyst", "project_manager"],
    });
    expect(await profileOf(U(2))).toEqual({
      target_role: "product_owner",
      target_roles: ["product_owner"],
    });
    expect(await profileOf(U(3))).toEqual({
      target_role: "product_owner",
      target_roles: ["product_owner", "qa"],
    });
    expect(await profileOf(U(4))).toEqual({
      target_role: "product_marketing",
      target_roles: ["product_marketing"],
    });
    expect(await profileOf(U(5))).toEqual({
      target_role: "project_manager",
      target_roles: ["project_manager"],
    });
  });

  it("sin titular queda product_manager y target_role es igual al primero", async () => {
    await addProfile(1, null, [LEGACY]);
    await addProfile(2, "Analista funcional", [LEGACY]);
    // "proyectos" suelto no alcanza: la regla es la de defaultRole (self-assessment.ts)
    await addProfile(3, "Analista de proyectos de datos", [LEGACY]);
    await addJob(U(3), 1, LEGACY);
    await runMigration();
    expect(await matchedRoleOf(1)).toBe("product_manager");
    for (const n of [1, 2, 3]) {
      expect(await profileOf(U(n))).toEqual({
        target_role: "product_manager",
        target_roles: ["product_manager"],
      });
    }
  });

  it("si la carrera nueva ya estaba en la lista, la vieja se quita sin repetir ni vaciar", async () => {
    await addProfile(1, "Product Manager", ["product_manager", LEGACY]);
    await addProfile(2, "Product Manager", [LEGACY, "product_manager"]);
    await runMigration();
    expect(await profileOf(U(1))).toEqual({
      target_role: "product_manager",
      target_roles: ["product_manager"],
    });
    expect(await profileOf(U(2))).toEqual({
      target_role: "product_manager",
      target_roles: ["product_manager"],
    });
  });

  it("no toca a quien no tenía la clave vieja", async () => {
    await addProfile(1, "Scrum Master", ["qa", "ux_ui"]);
    await addProfile(2, null, []);
    await runMigration();
    expect(await profileOf(U(1))).toEqual({ target_role: "qa", target_roles: ["qa", "ux_ui"] });
    expect(await profileOf(U(2))).toEqual({ target_role: null, target_roles: [] });
  });

  it("correrla dos veces da lo mismo", async () => {
    await addProfile(1, "Scrum Master", ["data_analyst", LEGACY]);
    await addProfile(2, "Product Owner", [LEGACY]);
    await addJob(U(1), 1, LEGACY);
    await owner`insert into waitlist (email, name, role)
      values ('p1@producto-97.example.com', 'Persona Ficticia', ${LEGACY})`;
    await runMigration();
    const first = [await profileOf(U(1)), await profileOf(U(2)), await matchedRoleOf(1)];
    await runMigration();
    expect([await profileOf(U(1)), await profileOf(U(2)), await matchedRoleOf(1)]).toEqual(first);
  });

  it("jobs.matched_role pasa con la misma regla del perfil; el resto queda igual", async () => {
    await addProfile(1, "Scrum Master", [LEGACY]);
    await addProfile(2, "Product Owner", ["qa"]);
    await addProfile(3, null, [LEGACY]);
    await addJob(U(1), 1, LEGACY);
    await addJob(U(2), 2, LEGACY);
    await addJob(U(3), 3, LEGACY);
    // Sin perfil: cae en product_manager
    await addJob(U(7), 4, LEGACY);
    await addJob(U(1), 5, "qa");
    await addJob(U(1), 6, null);
    await runMigration();
    expect(await matchedRoleOf(1)).toBe("project_manager");
    expect(await matchedRoleOf(2)).toBe("product_owner");
    expect(await matchedRoleOf(3)).toBe("product_manager");
    expect(await matchedRoleOf(4)).toBe("product_manager");
    expect(await matchedRoleOf(5)).toBe("qa");
    expect(await matchedRoleOf(6)).toBeNull();
  });

  it("la lista de espera queda migrada a product_manager", async () => {
    await owner`insert into waitlist (email, name, role) values
      ('p1@producto-97.example.com', 'Persona Ficticia', ${LEGACY}),
      ('p2@producto-97.example.com', 'Persona Ficticia', 'product_owner'),
      ('p3@producto-97.example.com', 'Persona Ficticia', 'qa')`;
    await runMigration();
    const rows = await owner<{ email: string; role: string }[]>`
      select email, role from waitlist where email like ${EMAIL_LIKE} order by email`;
    expect(rows.map((r) => r.role)).toEqual(["product_manager", "product_owner", "qa"]);
  });
});
