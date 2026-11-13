import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Cuentas de prueba (T-1, users.is_test y rls/0020): no cuentan en las métricas de la beta ni hacen
 * madurar una carrera. Datos inventados. Mismo montaje que metricas.integration.test.ts.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9200000-0000-4000-8000-0000000000aa";
const REAL = [1, 2, 3].map((i) => `d9200000-0000-4000-8000-00000000000${i}`);
const TEST = [4, 5, 6, 7, 8].map((i) => `d9200000-0000-4000-8000-00000000000${i}`);
const ROLE = "abogacia";
const ALL = [ADMIN_ID, ...REAL, ...TEST];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function verdictFor(userId: string): Promise<void> {
  const [job] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized, matched_role)
    values (${userId}, 'Empresa A', 'Abogada', 'abogada', ${ROLE}) returning id`;
  await owner`
    insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd,
      score, location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros,
      senales_positivas, veredicto, accion, human_verdict, human_verdict_at)
    values (${job!.id}, ${userId}, 1, 'evaluate_job@test', 'fake', true, 7, 'ok', 'remoto', 'data',
      '{}', '{}', '{}', '{}', 'ficticio', 'aplicar', 'de_acuerdo', now())`;
  await owner`insert into applications (job_id, user_id) values (${job!.id}, ${userId})`;
}

async function adminMetrics(): Promise<Record<string, unknown>> {
  const rows = (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${ADMIN_ID}, true)`;
    return tx`select admin_beta_metrics() as m`;
  })) as unknown as { m: Record<string, unknown> }[];
  return rows[0]!.m;
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
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
  for (const id of ALL) {
    const isTest = TEST.includes(id);
    await owner`insert into users (id, email, name, is_test)
      values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio', ${isTest}) on conflict (id) do nothing`;
    await owner`insert into profiles (user_id, display_name, location_country, target_roles, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${[ROLE]}, ${`p${id.slice(-4)}`}) on conflict (user_id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner`delete from applications where user_id in ${owner(ALL)}`;
    await owner`delete from evaluations where user_id in ${owner(ALL)}`;
    await owner`delete from jobs where user_id in ${owner(ALL)}`;
    await owner`delete from profiles where user_id in ${owner(ALL)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(ALL)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("cuentas de prueba fuera de las métricas (T-1)", () => {
  it("is_test es false por defecto: una cuenta común cuenta", async () => {
    const [row] = await owner<
      { is_test: boolean }[]
    >`select is_test from users where id = ${REAL[0]!}`;
    expect(row).toEqual({ is_test: false });
  });

  it("5 cuentas de prueba con 👍 y postulaciones no destapan ni hacen madurar nada", async () => {
    for (const id of TEST) await verdictFor(id);
    // Sin cuentas reales activas, el tablero queda enmascarado: las de prueba no suman personas
    expect(await adminMetrics()).toMatchObject({
      active_30d: null,
      evaluations_30d: null,
      verdict_up_30d: null,
      applications_30d: null,
    });
    // 5 personas opinando alcanzarían la regla de 👍 si contaran: la carrera ni aparece
    const rules = await app<{ role: string }[]>`select role from career_maturity_stats()`;
    expect(rules.map((r) => r.role)).not.toContain(ROLE);
  });

  it("con 3 cuentas reales el tablero cuenta 3 personas y 3 postulaciones, no 8", async () => {
    for (const id of REAL) await verdictFor(id);
    expect(await adminMetrics()).toMatchObject({
      k: 3,
      active_30d: 3,
      evaluations_30d: 3,
      verdict_up_30d: 3,
      applications_30d: 3,
    });
  });

  it("al marcar una cuenta real como de prueba deja de contar", async () => {
    await owner`update users set is_test = true where id = ${REAL[2]!}`;
    expect(await adminMetrics()).toMatchObject({ active_30d: null, applications_30d: null });
  });
});
