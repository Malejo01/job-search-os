import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { DISCIPLINES, DISCIPLINES_V13 } from "@job-search-os/pipeline";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Migraciones 0022 y 0023 (ronda 43): el enum `discipline` pasa de 15 a 19 valores (0022, de
 * esquema) y a los criterios con las 15 de fábrica se les suman las 4 nuevas (0023, de datos).
 * Para probar la 0023 el test deja los criterios en el estado "entre la 0022 y la 0023" y corre el
 * SQL statement por statement, como el migrador. Mismos entornos que rls.integration.test.ts (CI:
 * DATABASE_URL; local: Testcontainer).
 */
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataSql = readFileSync(
  join(PKG_ROOT, "drizzle", "0023_criteria_disciplinas_digitales.sql"),
  "utf8",
);

const NEW_ONES = ["marketing_digital", "producto", "recursos_humanos", "customer_success"];
const DE_FABRICA = "a6000000-0000-4000-8000-000000000001";
const ACOTADA = "a6000000-0000-4000-8000-000000000002";
const YA_CON_19 = "a6000000-0000-4000-8000-000000000003";
const SIN_LISTA = "a6000000-0000-4000-8000-000000000004";
const USERS = [DE_FABRICA, ACOTADA, YA_CON_19, SIN_LISTA];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function runDataMigration() {
  for (const statement of dataSql.split("--> statement-breakpoint")) {
    await owner.unsafe(statement);
  }
}

async function disciplinesOf(userId: string) {
  const [row] = await owner<{ allowed: string[] | null }[]>`
    select rules->'allowed_disciplines' as allowed from evaluation_criteria where user_id = ${userId}`;
  return row!.allowed;
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
  owner = postgres(ownerUrl, { max: 2 });
  await owner`delete from evaluation_criteria where user_id = any(${USERS})`;
  await owner`delete from users where id = any(${USERS})`;
  for (const [i, id] of USERS.entries()) {
    await owner`insert into users (id, email) values (${id}, ${`u${i}@disciplinas.test`})`;
  }
  // Estado "entre la 0022 y la 0023": cada criterio como lo dejaron las migraciones anteriores
  const rules = (allowed: readonly string[] | null) =>
    allowed === null ? { thresholds: {} } : { thresholds: {}, allowed_disciplines: allowed };
  const rows: [string, readonly string[] | null][] = [
    [DE_FABRICA, DISCIPLINES_V13],
    [ACOTADA, ["ai_engineer", "fullstack"]],
    [YA_CON_19, DISCIPLINES],
    [SIN_LISTA, null],
  ];
  for (const [id, allowed] of rows) {
    await owner`insert into evaluation_criteria (user_id, version, active, rules)
      values (${id}, 1, true, ${owner.json(rules(allowed) as never)})`;
  }
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from evaluations where user_id = any(${USERS})`;
    await owner`delete from jobs where user_id = any(${USERS})`;
    await owner`delete from evaluation_criteria where user_id = any(${USERS})`;
    await owner`delete from users where id = any(${USERS})`;
  }
  await owner?.end();
  await container?.stop();
});

describe("0022: enum discipline", () => {
  it("tiene los 19 valores, los 4 nuevos al final", async () => {
    const rows = await owner<{ enumlabel: string }[]>`
      select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'discipline' order by e.enumsortorder`;
    const labels = rows.map((r) => r.enumlabel);
    expect(labels).toHaveLength(19);
    expect(labels.slice(-4)).toEqual(NEW_ONES);
    expect([...labels].sort()).toEqual([...DISCIPLINES].sort());
  });

  it("una evaluación con marketing_digital se guarda", async () => {
    const [job] = await owner<{ id: string }[]>`
      insert into jobs (user_id, company_raw, title, title_normalized)
      values (${DE_FABRICA}, 'Empresa A', 'Analista de Marketing', 'analista marketing') returning id`;
    await owner`insert into evaluations (job_id, user_id, criteria_version, prompt_version, model,
        had_full_jd, score, location_ok, modality, discipline, years_discipline, match_fuerte, gaps,
        bloqueadores_duros, senales_positivas, veredicto, accion)
      values (${job!.id}, ${DE_FABRICA}, 1, 'p@v1.4.0', 'm', true, 7, 'ok', 'remoto',
        'marketing_digital', 'customer_success', '{}', '{}', '{}', '{}', 'ok', 'aplicar')`;
    const [row] = await owner<{ discipline: string; years_discipline: string }[]>`
      select discipline, years_discipline from evaluations where job_id = ${job!.id}`;
    expect(row).toEqual({ discipline: "marketing_digital", years_discipline: "customer_success" });
  });
});

describe("0023: criterios de fábrica", () => {
  it("antes de correrla, el criterio de fábrica tiene 15", async () => {
    expect(await disciplinesOf(DE_FABRICA)).toHaveLength(15);
  });

  it("suma los 4 a los de fábrica; no toca la lista acotada, la ya completa ni la ausente", async () => {
    await runDataMigration();
    expect(await disciplinesOf(DE_FABRICA)).toEqual([...DISCIPLINES]);
    expect(await disciplinesOf(ACOTADA)).toEqual(["ai_engineer", "fullstack"]);
    expect(await disciplinesOf(YA_CON_19)).toEqual([...DISCIPLINES]);
    expect(await disciplinesOf(SIN_LISTA)).toBeNull();
  });

  it("es idempotente: correrla de nuevo no duplica", async () => {
    await runDataMigration();
    await runDataMigration();
    expect(await disciplinesOf(DE_FABRICA)).toEqual([...DISCIPLINES]);
    expect(await disciplinesOf(ACOTADA)).toEqual(["ai_engineer", "fullstack"]);
  });

  it("completa solo los que faltan en una lista de fábrica con un valor nuevo ya presente", async () => {
    await owner`update evaluation_criteria
      set rules = jsonb_set(rules, '{allowed_disciplines}', ${owner.json([...DISCIPLINES_V13, "producto"] as never)})
      where user_id = ${DE_FABRICA}`;
    await runDataMigration();
    const lista = (await disciplinesOf(DE_FABRICA))!;
    expect(lista).toHaveLength(19);
    expect(lista.filter((d) => d === "producto")).toHaveLength(1);
  });
});
