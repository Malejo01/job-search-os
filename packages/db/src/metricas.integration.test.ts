import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Métricas agregadas (C-13 y C-14, rls/0009) por el camino real: la app como jobsearch_app. Solo
 * vuelven sí/no o números; el k-anonimato cuenta personas distintas, no filas. Datos inventados.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "d9100000-0000-4000-8000-0000000000aa";
const PEOPLE = [1, 2, 3, 4, 5, 6].map((i) => `d9100000-0000-4000-8000-00000000000${i}`);
const ROLE = "data_engineer";
const ALL = [ADMIN_ID, ...PEOPLE];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

/** Una oferta propia evaluada con un 👍 o 👎, y opcionalmente una postulación. */
async function verdictFor(
  userId: string,
  verdict: "de_acuerdo" | "en_desacuerdo",
  applied = false,
): Promise<void> {
  const [job] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized, matched_role)
    values (${userId}, 'Empresa A', 'Data Engineer', 'data engineer', ${ROLE}) returning id`;
  await owner`
    insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd,
      score, location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros,
      senales_positivas, veredicto, accion, human_verdict, human_verdict_at)
    values (${job!.id}, ${userId}, 1, 'evaluate_job@test', 'fake', true, 7, 'ok', 'remoto', 'data',
      '{}', '{}', '{}', '{}', 'ficticio', 'aplicar', ${verdict}, now())`;
  if (applied)
    await owner`insert into applications (job_id, user_id) values (${job!.id}, ${userId})`;
}

type Rules = { role: string; offers_ok: boolean; thumbs_ok: boolean | null; active_ok: boolean };

async function rulesFor(role: string): Promise<Rules | undefined> {
  const rows = await app<Rules[]>`select * from career_maturity_stats()`;
  return rows.find((r) => r.role === role);
}

async function adminMetrics(): Promise<Record<string, unknown>> {
  const [row] = await asUser(
    ADMIN_ID,
    (tx) => tx<{ m: Record<string, unknown> }[]>`select admin_beta_metrics() as m`,
  );
  return row!.m;
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
    await owner`insert into users (id, email, name) values (${id}, ${`${id.slice(-4)}@ejemplo.test`}, 'Ficticio')
      on conflict (id) do nothing`;
    // Un perfil sigue además un texto libre: nunca tiene que salir de la función
    await owner`insert into profiles (user_id, display_name, location_country, target_roles, inbound_address)
      values (${id}, 'Ficticio', 'AR', ${[ROLE, "texto libre de una persona"]}, ${`m${id.slice(-4)}`})
      on conflict (user_id) do nothing`;
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

describe("métricas agregadas (C-13, C-14)", () => {
  it("una sola persona con muchas opiniones no destapa nada: k cuenta personas", async () => {
    for (let i = 0; i < 4; i++) await verdictFor(PEOPLE[0]!, "de_acuerdo", true);
    expect(await rulesFor(ROLE)).toMatchObject({ thumbs_ok: null, active_ok: false });
    const m = await adminMetrics();
    expect(m).toMatchObject({
      active_30d: null,
      verdict_up_30d: null,
      applications_30d: null,
      evaluations_30d: null,
    });
  });

  it("con 5 personas opinando, la regla de 👍 se evalúa y solo vuelve sí/no", async () => {
    for (const p of PEOPLE.slice(1, 5)) await verdictFor(p, "de_acuerdo");
    const r = await rulesFor(ROLE);
    expect(r).toEqual({ role: ROLE, offers_ok: false, thumbs_ok: true, active_ok: false });
  });

  it("las carreras salen del pool y de las ofertas, nunca del texto libre de un perfil", async () => {
    const rows = await app<Rules[]>`select * from career_maturity_stats()`;
    expect(rows.map((r) => r.role)).not.toContain("texto libre de una persona");
  });

  it("el rol de la app sigue sin leer evaluaciones ajenas", async () => {
    const rows = await asUser(PEOPLE[5]!, (tx) => tx`select count(*)::int as n from evaluations`);
    expect(rows[0]).toEqual({ n: 0 });
  });

  it("el tablero es solo para app_admins y enmascara por personas distintas", async () => {
    await expect(asUser(PEOPLE[0]!, (tx) => tx`select admin_beta_metrics() as m`)).rejects.toThrow(
      /admin_beta_metrics: no autorizado/,
    );
    // 5 personas activas y con opiniones; postulaciones de una sola persona: enmascaradas
    expect(await adminMetrics()).toMatchObject({
      k: 3,
      active_30d: 5,
      verdict_up_30d: 8,
      verdict_down_30d: 0,
      applications_30d: null,
      llm_cost_30d_usd: null,
    });
  });
});
