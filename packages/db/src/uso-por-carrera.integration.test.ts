import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Uso por carrera y por semana (R22-04, rls/0057) por el camino real: la app como jobsearch_app. La función
 * solo responde a app_admins, cuenta personas distintas por celda, deja afuera las cuentas de prueba y no
 * devuelve ninguna celda con menos de 3 personas. La segunda parte siembra 200 personas × 52 semanas con
 * datos inventados y mide la consulta con y sin los índices de fecha. Todo con alias y @example.com.
 */
const APP_PASSWORD = "jobsearch_app_test";
const ADMIN_ID = "e9300000-0000-4000-8000-0000000000aa";
const NO_ADMIN_ID = "e9300000-0000-4000-8000-0000000000bb";
const TZ = "America/Argentina/Buenos_Aires";

type Usage = {
  week: string;
  career: string;
  metric: string;
  value: number | null;
  people: number | null;
};

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let ownerUrl: string;

async function asUser<T>(userId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return (await app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return fn(tx as unknown as Sql);
  })) as T;
}

async function usage(userId = ADMIN_ID): Promise<Usage[]> {
  return asUser(
    userId,
    (tx) =>
      tx<
        Usage[]
      >`select week::text as week, career, metric, value, people from admin_usage_by_career()`,
  );
}

function cell(rows: Usage[], week: string, career: string, metric: string): Usage | undefined {
  return rows.find((r) => r.week === week && r.career === career && r.metric === metric);
}

beforeAll(async () => {
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
  owner = postgres(ownerUrl, { max: 2, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });
}, 180_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await container?.stop();
});

/** Lunes 00:00 de Buenos Aires de la semana en curso, como instante. */
async function currentMonday(): Promise<Date> {
  const [r] = await owner<{ t: Date }[]>`
    select (date_trunc('week', now() at time zone ${TZ}) at time zone ${TZ}) as t`;
  return r!.t;
}

describe("uso por carrera: la semántica", () => {
  const person = (n: number) => `e9310000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  // 1-3 backend · 4-5 frontend · 6-8 qa (solo evaluaciones del sistema) · 9-11 texto libre
  // 12-14 ux_ui (solo ofertas cargadas) · 15 backend de prueba (is_test)
  const BACKEND = [1, 2, 3];
  let monday: Date;
  let week0 = "";
  let weekPrev = "";
  let rows: Usage[] = [];

  async function seedUser(n: number, role: string[] | null, isTest = false) {
    const id = person(n);
    await owner`insert into users (id, email, name, is_test) values (${id}, ${`u${n}@example.com`}, 'Ficticio', ${isTest})`;
    await owner`insert into profiles (user_id, display_name, location_country, inbound_address, target_roles)
      values (${id}, 'Ficticio', 'AR', ${`i${n}`}, ${role ?? []})`;
    const [job] = await owner<{ id: string }[]>`
      insert into jobs (user_id, company_raw, title, title_normalized, created_at)
      values (${id}, 'Empresa A', 'Puesto A', 'puesto a', now() - interval '200 days') returning id`;
    return { id, jobId: job!.id };
  }

  async function evaluation(u: { id: string; jobId: string }, at: Date, verdict: string | null) {
    await owner`
      insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd,
        score, location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros,
        senales_positivas, veredicto, accion, human_verdict, human_verdict_at, created_at)
      values (${u.jobId}, ${u.id}, 1, 'evaluate_job@test', 'fake', true, 7, 'ok', 'remoto', 'data',
        '{}', '{}', '{}', '{}', 'ficticio', 'aplicar', ${verdict}, ${verdict ? at : null}, ${at})`;
  }

  async function call(id: string, task: string, at: Date, label: string | null, ok = true) {
    await owner`insert into llm_calls (user_id, task, model, ok, label, created_at)
      values (${id}, ${task}, 'fake', ${ok}, ${label}, ${at})`;
  }

  beforeAll(async () => {
    monday = await currentMonday();
    const at = new Date(monday.getTime() + 12 * 3_600_000); // lunes 12:00 de esta semana
    const prev = new Date(at.getTime() - 7 * 86_400_000);
    const old = new Date(at.getTime() - 70 * 86_400_000); // fuera de las 8 semanas
    const [w] = await owner<
      { w: string }[]
    >`select (${monday}::timestamptz at time zone ${TZ})::date::text as w`;
    week0 = w!.w;
    const [p] = await owner<
      { w: string }[]
    >`select ((${monday}::timestamptz at time zone ${TZ})::date - 7)::text as w`;
    weekPrev = p!.w;

    await owner`insert into users (id, email, name) values (${ADMIN_ID}, 'admin@example.com', 'Ficticio'),
      (${NO_ADMIN_ID}, 'otra@example.com', 'Ficticio')`;
    await owner`insert into app_admins (user_id) values (${ADMIN_ID})`;

    const users = new Map<number, { id: string; jobId: string }>();
    for (const n of BACKEND) users.set(n, await seedUser(n, ["backend"]));
    for (const n of [4, 5]) users.set(n, await seedUser(n, ["frontend"]));
    for (const n of [6, 7, 8]) users.set(n, await seedUser(n, ["qa"]));
    for (const n of [9, 10, 11]) users.set(n, await seedUser(n, ["texto libre"]));
    for (const n of [12, 13, 14]) users.set(n, await seedUser(n, ["ux_ui"]));
    users.set(15, await seedUser(15, ["backend"], true));

    // backend (3 personas): 2 evaluaciones cada una (6), 👍 de 1 y 2 (2 personas), 👎 de 3 (1 persona)
    for (const n of BACKEND) {
      const u = users.get(n)!;
      await evaluation(u, at, n === 3 ? "en_desacuerdo" : "de_acuerdo");
      await evaluation(u, at, null);
      await owner`insert into applications (job_id, user_id, created_at) values (${u.jobId}, ${u.id}, ${at})`;
      await call(u.id, "cv_review", at, null);
      // una sola persona simula: queda por debajo de k
    }
    await call(person(1), "cv_review", at, null, false); // fallida: no cuenta
    await call(person(1), "cv_coach_turn", at, "cv:a");
    await call(person(1), "cv_interview", at, "cv:b");
    await call(person(2), "cv_coach_turn", at, "cv:b");
    await call(person(3), "cv_write", at, "cv:c");
    await call(person(3), "cv_write", at, "cv:c"); // misma charla: una
    await owner`insert into interview_sessions (user_id, source_kind, career, title, questions, status)
      values (${person(1)}, 'career', 'backend', 'Backend', '["a","b","c","d","e"]'::jsonb, 'terminada')`;
    await owner`update interview_sessions set created_at = ${at} where user_id = ${person(1)}`;
    // La cuenta de prueba hace de todo y no cuenta
    const t = users.get(15)!;
    await evaluation(t, at, "de_acuerdo");
    await owner`insert into applications (job_id, user_id, created_at) values (${t.jobId}, ${t.id}, ${at})`;
    // Semana anterior y una fuera de la ventana
    for (const n of BACKEND) {
      const u = users.get(n)!;
      await owner`insert into applications (job_id, user_id, created_at) values (${u.jobId}, ${u.id}, ${prev})`;
      await owner`insert into applications (job_id, user_id, created_at) values (${u.jobId}, ${u.id}, ${old})`;
    }
    // frontend: solo 2 personas con de todo
    for (const n of [4, 5]) {
      const u = users.get(n)!;
      await evaluation(u, at, "de_acuerdo");
      await owner`insert into applications (job_id, user_id, created_at) values (${u.jobId}, ${u.id}, ${at})`;
    }
    // qa: solo evaluaciones del sistema (3 personas): se ven, pero nadie está «activo»
    for (const n of [6, 7, 8]) await evaluation(users.get(n)!, at, null);
    // texto libre: caen en sin_carrera, con una postulación cada una
    for (const n of [9, 10, 11]) {
      const u = users.get(n)!;
      await owner`insert into applications (job_id, user_id, created_at) values (${u.jobId}, ${u.id}, ${at})`;
    }
    // ux_ui: solo ofertas cargadas a mano (public_job_id null): cuenta como actividad
    await owner`update jobs set created_at = ${at} where user_id in ${owner([12, 13, 14].map(person))}`;
    rows = await usage();
  }, 120_000);

  it("un no admin recibe un error y nada más", async () => {
    await expect(usage(NO_ADMIN_ID)).rejects.toThrow(/admin_usage_by_career: no autorizado/);
  });

  it("cuenta por carrera y semana, personas distintas y una charla una sola vez", () => {
    expect(cell(rows, week0, "backend", "active")).toMatchObject({ value: 3, people: 3 });
    expect(cell(rows, week0, "backend", "evaluated")).toMatchObject({ value: 6, people: 3 });
    expect(cell(rows, week0, "backend", "applications")).toMatchObject({ value: 3, people: 3 });
    expect(cell(rows, week0, "backend", "cv_reviews")).toMatchObject({ value: 3, people: 3 });
    // cv:a, cv:b (dos personas) y cv:c (dos llamadas): 3 charlas, 3 personas
    expect(cell(rows, week0, "backend", "coach_chats")).toMatchObject({ value: 3, people: 3 });
  });

  it("la semana anterior tiene su propia fila y lo de hace 10 semanas no aparece", () => {
    expect(cell(rows, weekPrev, "backend", "applications")).toMatchObject({ value: 3, people: 3 });
    expect(rows.some((r) => r.week < weekPrev)).toBe(false);
  });

  it("una celda con menos de 3 personas no sale: ni como null ni con su conteo", () => {
    // 👍 de 2 personas, 👎 y simulación de 1
    expect(cell(rows, week0, "backend", "up")).toBeUndefined();
    expect(cell(rows, week0, "backend", "down")).toBeUndefined();
    expect(cell(rows, week0, "backend", "interviews")).toBeUndefined();
    // frontend: 2 personas, ninguna fila
    expect(rows.filter((r) => r.career === "frontend")).toEqual([]);
    expect(rows.every((r) => r.value !== null && r.people !== null && r.people >= 3)).toBe(true);
  });

  it("las cuentas de prueba no cuentan", () => {
    // sin la de prueba son 3 postulaciones; con ella serían 4
    expect(cell(rows, week0, "backend", "applications")?.value).toBe(3);
    expect(cell(rows, week0, "backend", "up")).toBeUndefined();
  });

  it("las evaluaciones del sistema no hacen activa a una persona", () => {
    expect(cell(rows, week0, "qa", "evaluated")).toMatchObject({ value: 3, people: 3 });
    expect(cell(rows, week0, "qa", "active")).toBeUndefined();
  });

  it("una carrera con texto libre cae en sin_carrera y el texto no sale", () => {
    expect(cell(rows, week0, "sin_carrera", "active")).toMatchObject({ value: 3, people: 3 });
    expect(JSON.stringify(rows)).not.toContain("texto libre");
  });

  it("una oferta cargada a mano cuenta como actividad", () => {
    expect(cell(rows, week0, "ux_ui", "active")).toMatchObject({ value: 3, people: 3 });
    expect(cell(rows, week0, "ux_ui", "evaluated")).toBeUndefined();
  });

  it("devuelve solo semana, carrera, métrica, valor y personas: ni emails ni ids", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows)
      expect(Object.keys(r).sort()).toEqual(["career", "metric", "people", "value", "week"]);
    expect(JSON.stringify(rows)).not.toMatch(/@|e93\d{5}-/);
  });
});

describe("uso por carrera: tiempo con 200 personas × 52 semanas", () => {
  const N = 200;
  const WEEKS = 52;
  const CAREERS = [
    "frontend",
    "backend",
    "fullstack",
    "qa",
    "data_analyst",
    "ux_ui",
    "marketing_digital",
    "soporte_it",
    "ventas_b2b",
    "abogacia",
  ];
  const INDEXES: [string, string][] = [
    ["evaluations_created_at", "evaluations (created_at)"],
    ["evaluations_verdict_at", "evaluations (human_verdict_at) where human_verdict_at is not null"],
    ["applications_created_at", "applications (created_at)"],
    ["interview_sessions_created_at", "interview_sessions (created_at)"],
    ["jobs_manual_created", "jobs (created_at) where public_job_id is null"],
  ];

  async function timeMs(runs = 5): Promise<number[]> {
    const out: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      await usage();
      out.push(Math.round(performance.now() - t0));
    }
    return out;
  }

  it("el resultado es el mismo con y sin índices, y se mide el tiempo", async () => {
    const monday = await currentMonday();
    const iso = monday.toISOString();
    const roles = `array[${CAREERS.map((c) => `'${c}'`).join(",")}]`;
    // Personas y ofertas (una por persona)
    await owner.unsafe(`
      insert into users (id, email, name)
      select ('e9400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'm' || i || '@example.com', 'Ficticio'
        from generate_series(1, ${N}) i;
      insert into profiles (user_id, display_name, location_country, inbound_address, target_roles)
      select ('e9400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Ficticio', 'AR', 'm' || i,
             array[(${roles})[1 + (i % ${CAREERS.length})]]
        from generate_series(1, ${N}) i;
      insert into jobs (user_id, company_raw, title, title_normalized, created_at)
      select ('e9400000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Empresa A', 'Puesto A', 'puesto a',
             now() - interval '400 days'
        from generate_series(1, ${N}) i;
    `);
    // Una acción por tipo por semana y persona, y 3 evaluaciones, durante 52 semanas
    await owner.unsafe(`
      create temp table seed_grid as
      select j.id as job_id, j.user_id, w, '${iso}'::timestamptz - (w * 7) * interval '1 day' + interval '12 hours' as at
        from jobs j cross join generate_series(0, ${WEEKS - 1}) w
       where j.user_id::text like 'e9400000%';
      insert into evaluations (job_id, user_id, criteria_version, prompt_version, model, had_full_jd,
        score, location_ok, modality, discipline, match_fuerte, gaps, bloqueadores_duros,
        senales_positivas, veredicto, accion, human_verdict, human_verdict_at, created_at)
      select g.job_id, g.user_id, 1, 'evaluate_job@test', 'fake', true, 7, 'ok', 'remoto', 'data',
             '{}', '{}', '{}', '{}', 'ficticio', 'aplicar',
             case when k = 1 then 'de_acuerdo'::human_verdict when k = 2 then 'en_desacuerdo'::human_verdict end,
             case when k < 3 then g.at + k * interval '1 hour' end,
             g.at + k * interval '1 hour'
        from seed_grid g cross join generate_series(1, 3) k;
      insert into applications (job_id, user_id, created_at) select job_id, user_id, at from seed_grid;
      insert into interview_sessions (user_id, source_kind, career, title, questions, created_at)
      select user_id, 'career', 'backend', 'Backend', '["a","b","c","d","e"]'::jsonb, at from seed_grid;
      insert into llm_calls (user_id, task, model, ok, label, created_at)
      select user_id, 'cv_review', 'fake', true, null, at from seed_grid;
      insert into llm_calls (user_id, task, model, ok, label, created_at)
      select user_id, 'cv_coach_turn', 'fake', true, 'cv:' || user_id || '-' || w, at from seed_grid;
    `);

    // Sin índices de fecha
    for (const [name] of INDEXES) await owner.unsafe(`drop index if exists ${name}`);
    await owner.unsafe("analyze evaluations, applications, interview_sessions, llm_calls, jobs");
    const without = await usage();
    const timesWithout = await timeMs();

    // Con índices de fecha (los mismos de schema.ts)
    for (const [name, def] of INDEXES)
      await owner.unsafe(`create index if not exists ${name} on ${def}`);
    await owner.unsafe("analyze evaluations, applications, interview_sessions, llm_calls, jobs");
    const withIdx = await usage();
    const timesWith = await timeMs();

    // Qué plan usa (auto_explain sobre las sentencias anidadas de la función, como superusuario)
    const plans: string[] = [];
    const explainer = postgres(ownerUrl, {
      max: 1,
      prepare: false,
      onnotice: (n) => {
        if (typeof n.message === "string" && n.message.includes("plan:")) plans.push(n.message);
      },
    });
    try {
      await explainer.begin(async (tx) => {
        await tx.unsafe("load 'auto_explain'");
        await tx.unsafe("set auto_explain.log_min_duration = 0");
        await tx.unsafe("set auto_explain.log_nested_statements = on");
        await tx.unsafe("set client_min_messages = log");
        await tx`select set_config('app.user_id', ${ADMIN_ID}, true)`;
        await tx`select count(*) from admin_usage_by_career()`;
      });
    } catch (e) {
      plans.push(`auto_explain no disponible: ${(e as Error).message}`);
    } finally {
      await explainer.end();
    }
    const planText = plans.join("\n");
    const used = INDEXES.map(([name]) => name).filter((name) => planText.includes(name));
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;
    const counts = await owner<{ e: number; a: number; i: number; l: number }[]>`
      select (select count(*) from evaluations)::int as e, (select count(*) from applications)::int as a,
             (select count(*) from interview_sessions)::int as i, (select count(*) from llm_calls)::int as l`;
    console.log(
      `[uso-por-carrera] filas: ${JSON.stringify(counts[0])}; sin índices (ms): ${timesWithout.join(",")} ` +
        `mediana ${median(timesWithout)}; con índices (ms): ${timesWith.join(",")} mediana ${median(timesWith)}; ` +
        `índices usados en el plan: ${used.join(", ") || "ninguno"}; filas devueltas: ${withIdx.length}`,
    );
    const tail = planText.match(/Execution Time: [\d.]+ ms/g);
    if (tail) console.log(`[uso-por-carrera] auto_explain: ${tail.join(" | ")}`);

    expect(withIdx).toEqual(without);
    expect(withIdx.length).toBeGreaterThan(0);
    // Con 200 personas por 52 semanas tiene que responder holgadamente dentro de lo que tarda una página
    expect(median(timesWith)).toBeLessThan(3000);
  }, 300_000);
});
