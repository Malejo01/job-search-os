import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * R28-13: `admin_beta_metrics()` se reescribió (rls/0068) para que sea más barata. Acá se prueba que devuelve EXACTAMENTE
 * lo mismo que la versión de rls/0020. La versión vieja no se guarda en la base: el test la crea como copia temporal
 * (`admin_beta_metrics_vieja`) leyendo el cuerpo de `rls/0020_cuentas_de_prueba.sql`, y las dos corren sobre los mismos
 * datos: cuentas reales y de prueba (que quedan afuera), filas de hace más de 30 días, una persona que ya no está en
 * `users`, llamadas de IA sin persona y corridas de evals. Datos inventados. Mismo montaje que metricas.integration.test.ts.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ID = (n: number) => `e2800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN_ID = ID(900);
const REAL = [1, 2, 3, 4, 5].map(ID);
const TEST = [6, 7, 8].map(ID);
const GHOST = ID(99); // aparece en las tablas pero no en `users` (cuenta borrada): cuenta como real
const USERS = [ADMIN_ID, ...REAL, ...TEST];
const ALL = [...USERS, GHOST];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function metrics(
  fn: "admin_beta_metrics" | "admin_beta_metrics_vieja",
): Promise<Record<string, unknown>> {
  const rows = (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${ADMIN_ID}, true)`;
    return tx.unsafe(`select ${fn}() as m`);
  })) as unknown as { m: Record<string, unknown> }[];
  const { generated_at: _generatedAt, ...rest } = rows[0]!.m;
  return rest;
}

async function seedPerson(
  userId: string,
  index: number,
  opts: { old?: boolean } = {},
): Promise<void> {
  const when = opts.old ? "now() - interval '45 days'" : `now() - interval '${index} days'`;
  const [job] = await owner.unsafe<{ id: string }[]>(
    `insert into jobs (user_id, company_raw, title, title_normalized, created_at)
     values ('${userId}', 'Empresa A', 'Oferta ${index}', 'oferta ${index}', ${when}) returning id`,
  );
  await owner.unsafe(
    `insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd, score,
        location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros, senales_positivas, veredicto,
        accion, human_verdict, human_verdict_at, created_at)
     values ('${job!.id}', '${userId}', 1, 'evaluate_job@test', 'fake', true, 7, 'ok', 'remoto', 'data',
        '{}', '{}', '{}', '{}', 'ficticio', 'aplicar',
        '${index % 2 === 0 ? "de_acuerdo" : "en_desacuerdo"}', ${when}, ${when})`,
  );
  await owner.unsafe(
    `insert into applications (job_id, user_id, outcome, outcome_at, created_at)
     values ('${job!.id}', '${userId}', '${index % 2 === 0 ? "entrevista" : "oferta"}', ${when}, ${when})`,
  );
  await owner.unsafe(
    `insert into llm_calls (user_id, task, model, cost_usd, ok, created_at)
     values ('${userId}', 'evaluate_job', 'fake', 0.0${index + 1}, true, ${when})`,
  );
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

  // La versión de rls/0020, como copia temporal con otro nombre
  const sql0020 = readFileSync(join(__dirname, "..", "rls", "0020_cuentas_de_prueba.sql"), "utf8");
  const old = /CREATE OR REPLACE FUNCTION public\.admin_beta_metrics\(\)[\s\S]*?\$fn\$;/.exec(
    sql0020,
  )?.[0];
  if (!old) throw new Error("no se encontró admin_beta_metrics() en rls/0020");
  await owner.unsafe(
    old.replace("public.admin_beta_metrics()", "public.admin_beta_metrics_vieja()"),
  );
  await owner.unsafe(
    `GRANT EXECUTE ON FUNCTION public.admin_beta_metrics_vieja() TO authenticated`,
  );

  for (const id of USERS) {
    await owner`insert into users (id, email, name, is_test)
      values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio', ${TEST.includes(id)}) on conflict (id) do nothing`;
  }
  await owner`insert into app_admins (user_id) values (${ADMIN_ID}) on conflict do nothing`;
}, 180_000);

afterAll(async () => {
  if (owner) {
    await owner.unsafe(`drop function if exists public.admin_beta_metrics_vieja()`);
    await owner`delete from llm_calls where user_id in ${owner(ALL)}`;
    await owner`delete from applications where user_id in ${owner(ALL)}`;
    await owner`delete from evaluations where user_id in ${owner(ALL)}`;
    await owner`delete from jobs where user_id in ${owner(ALL)}`;
    await owner`delete from app_admins where user_id = ${ADMIN_ID}`;
    await owner`delete from users where id in ${owner(USERS)}`;
  }
  await app?.end();
  await owner?.end();
  await container?.stop();
});

async function igual(): Promise<Record<string, unknown>> {
  const nueva = await metrics("admin_beta_metrics");
  const vieja = await metrics("admin_beta_metrics_vieja");
  expect(nueva).toEqual(vieja);
  return nueva;
}

describe("admin_beta_metrics(): la versión nueva (rls/0068) da lo mismo que la de rls/0020 (R28-13)", () => {
  it("sin datos", async () => {
    await igual();
  });

  it("solo cuentas de prueba: las dos enmascaran igual", async () => {
    let i = 0;
    for (const id of TEST) await seedPerson(id, i++);
    const m = await igual();
    expect(m.active_30d).toBeNull();
  });

  it("con cuentas reales y de prueba, filas viejas, una persona borrada y llamadas sin persona", async () => {
    let i = 0;
    for (const id of REAL) await seedPerson(id, i++);
    // Filas de hace más de 30 días: no cuentan en ninguna de las dos
    await seedPerson(REAL[0]!, 20, { old: true });
    await seedPerson(TEST[0]!, 21, { old: true });
    // Una persona que no está en `users`: cuenta como real en las dos versiones
    await owner.unsafe(
      `insert into llm_calls (user_id, task, model, cost_usd, ok) values ('${GHOST}', 'evaluate_job', 'fake', 0.05, true)`,
    );
    // Llamadas sin persona y corridas de evals: quedan afuera del gasto en las dos
    await owner.unsafe(
      `insert into llm_calls (user_id, task, model, cost_usd, ok) values (null, 'evaluate_job', 'fake', 9, true),
         ('${REAL[0]!}', 'eval:v1', 'fake', 7, true)`,
    );
    const m = await igual();
    // Control: la prueba mide algo (con 5 personas reales hay números, no solo máscaras)
    expect(m.active_30d).toBe(5);
    expect(m.applications_30d).toBe(5);
    expect(m.llm_cost_30d_usd).not.toBeNull();
  });

  it("al marcar una cuenta real como de prueba, las dos la sacan", async () => {
    await owner`update users set is_test = true where id = ${REAL[4]!}`;
    const m = await igual();
    expect(m.active_30d).toBe(4);
  });

  it("al volver a marcarla real, las dos la cuentan otra vez", async () => {
    await owner`update users set is_test = false where id = ${REAL[4]!}`;
    const m = await igual();
    expect(m.active_30d).toBe(5);
  });
});
