import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as s from "@job-search-os/db/schema";
import { test } from "@playwright/test";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { assertLocalTestDatabase } from "../../../packages/db/src/test-guard";
import { ownerDb } from "./helpers";

/**
 * Flujo 309 (R28-13): consultas lentas con volumen. NO es una prueba de la app: es una herramienta de medición, y solo
 * corre si existe `ops/rondas/r28-tanda/.volumen` (o con `VOLUMEN=1`). Siempre contra la base LOCAL (falla cerrado si
 * la URL no es local, con la misma guarda que el resto de los e2e).
 *
 * Qué hace: siembra 5.000 ofertas y 50 personas inventadas (`r28vol-N@example.com`, ids `e2800000-…`; una persona
 * «pesada» con 1.500 ofertas y 49 con ~70), corre `ANALYZE`, y mide con `EXPLAIN (ANALYZE, BUFFERS)` las consultas de
 * Hoy, Match (lista y filtros), Tracker y del panel /admin, con el rol de la app (`jobsearch_app`) y `app.user_id`
 * fijado, o sea con RLS igual que en producción. Escribe el resultado en `ops/rondas/r28-tanda/consultas-resultado.md`.
 * Al final borra todo lo sembrado (también al empezar, por si una corrida anterior quedó a medias).
 *
 * Las consultas de Hoy y Match son el SQL que arma `listJobs` (`apps/web/lib/jobs.ts`), reescrito a mano sin las
 * expresiones de `checklist` del jsonb (cuestan CPU por fila, no cambian el plan). Las de /admin son las funciones SQL
 * que llaman las páginas (`admin_*`).
 */
const OUT_DIR = join(__dirname, "..", "..", "..", "ops", "rondas", "r28-tanda");
const ON = process.env.VOLUMEN === "1" || existsSync(join(OUT_DIR, ".volumen"));
const PREFIX = "e2800000-0000-4000-8000-";
const uid = (n: number) => `${PREFIX}${String(n).padStart(12, "0")}`;
const PEOPLE = 50;
const HEAVY = PEOPLE; // la persona 50 es la pesada
const ADMIN = 1;

test.describe.configure({ mode: "serial" });
test.skip(!ON, "herramienta de medición: solo con ops/rondas/r28-tanda/.volumen o VOLUMEN=1");
test.setTimeout(600_000);

const STATUSES = [
  "evaluada",
  "evaluada",
  "evaluada",
  "aplicada",
  "entrevista",
  "nueva",
  "prefiltrada",
] as const;

async function clean(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const like = sql`like ${`${PREFIX}%`}`;
    await db.execute(sql`delete from applications where user_id::text ${like}`);
    await db.execute(sql`delete from llm_calls where user_id::text ${like}`);
    await db.execute(sql`delete from jobs where user_id::text ${like}`); // evaluaciones y fuentes caen en cascada
    await db.execute(sql`delete from app_admins where user_id::text ${like}`);
    await db.execute(sql`delete from profiles where user_id::text ${like}`);
    await db.execute(sql`delete from users where id::text ${like}`);
  } finally {
    await close();
  }
}

async function seed(): Promise<{ jobs: number; evaluations: number; applications: number }> {
  const { db, close } = ownerDb();
  const now = Date.now();
  const DAY = 86_400_000;
  try {
    for (let n = 1; n <= PEOPLE; n++) {
      await db.insert(s.users).values({
        id: uid(n),
        email: `r28vol-${n}@example.com`,
        name: `Persona Volumen ${n}`,
        createdAt: new Date(now - (n % 40) * DAY),
      });
      await db.insert(s.profiles).values({
        userId: uid(n),
        displayName: `Persona Volumen ${n}`,
        locationCountry: "AR",
        inboundAddress: `r28vol_${n}`,
        targetRole: "finanzas_contabilidad",
        targetRoles: ["finanzas_contabilidad"],
        plan: n % 3 === 0 ? "lista" : "gratis",
        planUntil: n % 3 === 0 ? new Date(now + 20 * DAY) : null,
      });
    }
    await db.insert(s.appAdmins).values({ userId: uid(ADMIN) });

    let jobs = 0;
    let evaluations = 0;
    let applications = 0;
    const batch = 400;
    type JobRow = typeof s.jobs.$inferInsert;
    type EvalRow = typeof s.evaluations.$inferInsert;
    type SrcRow = typeof s.jobSources.$inferInsert;
    type AppRow = typeof s.applications.$inferInsert;
    let jobRows: JobRow[] = [];
    let evalRows: EvalRow[] = [];
    let srcRows: SrcRow[] = [];
    let appRows: AppRow[] = [];
    const flush = async () => {
      if (jobRows.length) await db.insert(s.jobs).values(jobRows);
      if (evalRows.length) await db.insert(s.evaluations).values(evalRows);
      if (srcRows.length) await db.insert(s.jobSources).values(srcRows);
      if (appRows.length) await db.insert(s.applications).values(appRows);
      jobRows = [];
      evalRows = [];
      srcRows = [];
      appRows = [];
    };
    for (let n = 1; n <= PEOPLE; n++) {
      const count = n === HEAVY ? 1500 : 70;
      for (let i = 0; i < count; i++) {
        const id = crypto.randomUUID();
        const status = STATUSES[(i + n) % STATUSES.length]!;
        const seen = new Date(now - ((i * 37 + n) % 120) * DAY - (i % 24) * 3_600_000);
        jobRows.push({
          id,
          userId: uid(n),
          companyRaw: `Empresa ${(i % 40) + 1}`,
          title: `Oferta de volumen ${n}-${i}`,
          titleNormalized: `oferta volumen ${n} ${i}`,
          canonicalUrl: `https://example.com/r28vol/${n}/${i}`,
          locationRaw: i % 3 === 0 ? "Buenos Aires" : "Remoto",
          modality: i % 3 === 0 ? "presencial" : "remoto",
          flags: [],
          status,
          firstSeenAt: seen,
          updatedAt: seen,
          createdAt: seen,
        });
        srcRows.push({
          jobId: id,
          kind: i % 2 === 0 ? "email_linkedin" : "jobicy",
          url: `https://example.com/r28vol/${n}/${i}`,
        });
        if (status === "evaluada" || status === "aplicada" || status === "entrevista") {
          const evals = i % 5 === 0 ? 2 : 1;
          for (let e = 0; e < evals; e++) {
            evalRows.push({
              jobId: id,
              userId: uid(n),
              criteriaVersion: 1,
              promptVersion: "evaluate_job@volumen",
              model: "fake",
              hadFullJd: true,
              score: ((i * 7 + e * 3 + n) % 100) / 10,
              locationOk: "ok",
              modality: "remoto",
              discipline: "ai_engineer",
              matchFuerte: ["skill a", "skill b"],
              gaps: ["gap a"],
              bloqueadoresDuros: [],
              riesgos: [],
              senalesPositivas: ["señal a"],
              veredicto: "Evaluación inventada para medir volumen.",
              accion: "aplicar",
              createdAt: new Date(seen.getTime() + (e + 1) * 3_600_000),
            });
            evaluations++;
          }
        }
        if (status === "aplicada" || status === "entrevista") {
          appRows.push({
            jobId: id,
            userId: uid(n),
            appliedAt: new Date(seen.getTime() + DAY),
            channel: "sitio_empresa",
            createdAt: new Date(seen.getTime() + DAY),
          });
          applications++;
        }
        jobs++;
        if (jobRows.length >= batch) await flush();
      }
    }
    await flush();

    // Gasto de IA de los últimos 30 días para el tablero de costos
    const calls: (typeof s.llmCalls.$inferInsert)[] = [];
    for (let n = 1; n <= PEOPLE; n++) {
      for (let i = 0; i < 100; i++) {
        calls.push({
          userId: uid(n),
          task: i % 4 === 0 ? "cv_write" : "evaluate_job",
          model: "fake",
          tokensIn: 3000,
          tokensOut: 400,
          latencyMs: 900,
          costUsd: 0.004,
          ok: i % 25 !== 0,
          createdAt: new Date(now - ((i * 11 + n) % 30) * DAY - (i % 24) * 3_600_000),
        });
      }
    }
    for (let i = 0; i < calls.length; i += 500) {
      await db.insert(s.llmCalls).values(calls.slice(i, i + 500));
    }
    await db.execute(sql`analyze jobs`);
    await db.execute(sql`analyze evaluations`);
    await db.execute(sql`analyze job_sources`);
    await db.execute(sql`analyze applications`);
    await db.execute(sql`analyze llm_calls`);
    await db.execute(sql`analyze users`);
    await db.execute(sql`analyze profiles`);
    return { jobs, evaluations, applications };
  } finally {
    await close();
  }
}

/** El SQL de `listJobs` (sin el jsonb del checklist). `where` y `since` son los filtros de cada caso. */
function listaSql(where: string): string {
  return `
select j.id, j.title, j.company_raw, j.status, j.location_raw, j.modality, j.canonical_url, src.url, j.salary_max_usd,
       j.first_seen_at, j.posted_at, j.flags, src.kinds, latest.score, latest.location_ok, latest.accion,
       latest.riesgos, latest.bloqueadores_duros, latest.match_fuerte, latest.gaps, latest.senales_positivas,
       latest.model, latest.id as evaluation_id, latest.human_verdict,
       (exists (select 1 from job_queue q where q.queue = 'evaluate_job' and q.status in ('pending','processing')
                and q.payload->>'jobId' = j.id::text)) as evaluating
  from jobs j
  left join (select distinct on (e.job_id) e.job_id, e.id, e.score, e.location_ok, e.accion, e.riesgos,
                    e.bloqueadores_duros, e.match_fuerte, e.gaps, e.senales_positivas, e.model, e.human_verdict, e.created_at
               from evaluations e order by e.job_id, e.created_at desc) latest on latest.job_id = j.id
  left join (select js.job_id, array_agg(distinct js.kind::text) as kinds, min(js.url) as url
               from job_sources js group by js.job_id) src on src.job_id = j.id
  left join public_jobs pj on pj.id = j.public_job_id
 where ${where}
 order by (exists (select 1 from job_queue q where q.queue = 'evaluate_job' and q.status in ('pending','processing')
                   and q.payload->>'jobId' = j.id::text)) desc,
          latest.score desc nulls last, coalesce(cardinality(latest.bloqueadores_duros), 0) asc,
          coalesce(cardinality(latest.riesgos), 0) asc, j.first_seen_at desc, j.id asc
 limit 100`;
}

const EVALUATING = `exists (select 1 from job_queue q where q.queue = 'evaluate_job' and q.status in ('pending','processing') and q.payload->>'jobId' = j.id::text)`;
const SIN_REVISAR = `(j.status = 'evaluada' or ${EVALUATING})`;

/** `owner`: corre con la conexión dueña (sin RLS), para medir el cuerpo de una función SECURITY DEFINER por partes. */
type Caso = { nombre: string; usuario: number; consulta: string; owner?: boolean };

const NO_TEST = (col: string) =>
  `not exists (select 1 from users tu where tu.id = ${col} and tu.is_test)`;

/** Las cuatro partes pesadas de `admin_beta_metrics()` (rls/0020), con la forma de hoy y con la propuesta. */
const PARTES_METRICAS: Caso[] = [
  {
    nombre: "métricas · hoy: personas activas (acts, `is_test_user()` por fila)",
    usuario: ADMIN,
    owner: true,
    consulta: `with acts as (
        select e.user_id, e.human_verdict_at as at from evaluations e where e.human_verdict_at is not null
        union all select a.user_id, a.created_at from applications a
        union all select j.user_id, j.created_at from jobs j where j.public_job_id is null)
      select count(distinct user_id) filter (where at > now() - interval '7 days'),
             count(distinct user_id) filter (where at > now() - interval '30 days')
        from acts where not public.is_test_user(acts.user_id)`,
  },
  {
    nombre: "métricas · propuesta: personas activas (filtro de 30 días en cada rama y anti-join)",
    usuario: ADMIN,
    owner: true,
    consulta: `with acts as (
        select e.user_id, e.human_verdict_at as at from evaluations e
          where e.human_verdict_at > now() - interval '30 days'
        union all select a.user_id, a.created_at from applications a
          where a.created_at > now() - interval '30 days'
        union all select j.user_id, j.created_at from jobs j
          where j.public_job_id is null and j.created_at > now() - interval '30 days')
      select count(distinct user_id) filter (where at > now() - interval '7 days'),
             count(distinct user_id) filter (where at > now() - interval '30 days')
        from acts where ${NO_TEST("acts.user_id")}`,
  },
  {
    nombre: "métricas · hoy: evaluaciones, postulaciones y gasto (`is_test_user()` por fila)",
    usuario: ADMIN,
    owner: true,
    consulta: `select
        (select count(*) from evaluations e where e.created_at > now() - interval '30 days' and not public.is_test_user(e.user_id)),
        (select count(*) from applications a where a.created_at > now() - interval '30 days' and not public.is_test_user(a.user_id)),
        (select coalesce(sum(c.cost_usd), 0) from llm_calls c where c.created_at > now() - interval '30 days'
            and c.task not like 'eval:%' and c.user_id is not null and not public.is_test_user(c.user_id))`,
  },
  {
    nombre: "métricas · propuesta: evaluaciones, postulaciones y gasto (anti-join con users)",
    usuario: ADMIN,
    owner: true,
    consulta: `select
        (select count(*) from evaluations e where e.created_at > now() - interval '30 days' and ${NO_TEST("e.user_id")}),
        (select count(*) from applications a where a.created_at > now() - interval '30 days' and ${NO_TEST("a.user_id")}),
        (select coalesce(sum(c.cost_usd), 0) from llm_calls c where c.created_at > now() - interval '30 days'
            and c.task not like 'eval:%' and c.user_id is not null and ${NO_TEST("c.user_id")})`,
  },
];

function casosDeApp(usuario: number, etiqueta: string): Caso[] {
  return [
    {
      nombre: `Hoy: lista de novedades (7 días) · ${etiqueta}`,
      usuario,
      consulta: listaSql(`latest.created_at >= now() - interval '7 days' and ${SIN_REVISAR}`),
    },
    { nombre: `Match: lista por defecto · ${etiqueta}`, usuario, consulta: listaSql(SIN_REVISAR) },
    {
      nombre: `Match: filtro puntaje mínimo 7 · ${etiqueta}`,
      usuario,
      consulta: listaSql(`(${SIN_REVISAR}) and (latest.score >= 7 or ${EVALUATING})`),
    },
    {
      nombre: `Match: filtro fuente · ${etiqueta}`,
      usuario,
      consulta: listaSql(`(${SIN_REVISAR}) and 'email_linkedin' = any(src.kinds)`),
    },
    {
      nombre: `Match: filtro «esta semana» · ${etiqueta}`,
      usuario,
      consulta: listaSql(`(${SIN_REVISAR}) and j.first_seen_at >= now() - interval '7 days'`),
    },
    {
      nombre: `Match: filtro «remoto» · ${etiqueta}`,
      usuario,
      consulta: listaSql(`(${SIN_REVISAR}) and j.modality = 'remoto'`),
    },
    {
      nombre: `Match: todas (estado «todas») · ${etiqueta}`,
      usuario,
      consulta: listaSql("true"),
    },
    {
      nombre: `Tracker: postulaciones · ${etiqueta}`,
      usuario,
      consulta: `select a.id, a.job_id, j.title, j.company_raw, j.status, a.applied_at, a.channel, a.outcome, a.outcome_at,
              a.outcome_note, a.follow_up_at, j.updated_at, latest.score, latest.accion, latest.model
         from applications a
         join jobs j on j.id = a.job_id
         left join (select distinct on (e.job_id) e.job_id, e.score, e.human_score, e.human_verdict, e.accion, e.model, e.location_ok
                      from evaluations e order by e.job_id, e.created_at desc) latest on latest.job_id = a.job_id
        order by a.applied_at desc, a.created_at desc`,
    },
    {
      nombre: `Tracker: seguimientos de hoy · ${etiqueta}`,
      usuario,
      consulta: `select a.job_id, j.title, j.company_raw, j.status, a.applied_at, a.outcome_at, a.follow_up_at
         from applications a join jobs j on j.id = a.job_id where j.status in ('aplicada','entrevista')`,
    },
    {
      nombre: `Tracker: evaluadas sin postular, viejas · ${etiqueta}`,
      usuario,
      consulta: `select j.id, j.title, j.company_raw, j.updated_at from jobs j left join applications a on a.job_id = j.id
        where j.status = 'evaluada' and a.id is null and j.updated_at <= now() - interval '30 days'
        order by j.updated_at limit 50`,
    },
    {
      nombre: `Tracker: informe de calibración · ${etiqueta}`,
      usuario,
      consulta: `select j.id, latest.score, latest.human_score, latest.human_verdict, latest.accion, latest.model,
              latest.location_ok, a.outcome, a.id
         from jobs j
         join (select distinct on (e.job_id) e.job_id, e.score, e.human_score, e.human_verdict, e.accion, e.model, e.location_ok
                 from evaluations e order by e.job_id, e.created_at desc) latest on latest.job_id = j.id
         left join applications a on a.job_id = j.id`,
    },
  ];
}

const CASOS: Caso[] = [
  ...casosDeApp(2, "persona típica (~70 ofertas)"),
  ...casosDeApp(HEAVY, "persona pesada (1.500 ofertas)"),
  {
    nombre: "/admin personas: lista (todas)",
    usuario: ADMIN,
    consulta: `select * from admin_people_list(null, 'todas', 50, 0)`,
  },
  {
    nombre: "/admin personas: búsqueda por email",
    usuario: ADMIN,
    consulta: `select * from admin_people_list('r28vol-3', 'todas', 50, 0)`,
  },
  {
    nombre: "/admin personas: filtro plan activo",
    usuario: ADMIN,
    consulta: `select * from admin_people_list(null, 'plan_activo', 50, 0)`,
  },
  {
    nombre: "/admin personas: ficha",
    usuario: ADMIN,
    consulta: `select * from admin_person_get('${uid(7)}'::uuid)`,
  },
  {
    nombre: "/admin personas: historial",
    usuario: ADMIN,
    consulta: `select * from admin_person_history('${uid(7)}'::uuid, 30)`,
  },
  { nombre: "/admin portada: resumen", usuario: ADMIN, consulta: `select admin_panel_summary()` },
  {
    nombre: "/admin métricas: admin_beta_metrics()",
    usuario: ADMIN,
    consulta: `select admin_beta_metrics()`,
  },
  {
    nombre: "/admin métricas: cupos de fundador",
    usuario: ADMIN,
    consulta: `select role, people from admin_founder_counts()`,
  },
  ...PARTES_METRICAS,
  {
    nombre: "/admin costos: tablero (30 días)",
    usuario: ADMIN,
    consulta: `select admin_llm_spend_board(30::int)`,
  },
  {
    nombre: "/admin salud: anomalías de gasto",
    usuario: ADMIN,
    consulta: `select admin_llm_spend_anomalies()`,
  },
  {
    nombre: "/admin feedback: últimos 50",
    usuario: ADMIN,
    consulta: `select created_at, category, path, message, person from admin_beta_feedback()`,
  },
];

function appUrl(): string {
  const base =
    process.env.DATABASE_URL_LOCAL ?? "postgres://postgres:postgres@localhost:54322/jobsearch";
  assertLocalTestDatabase(base);
  return (
    process.env.DATABASE_URL_APP_LOCAL ??
    base.replace("postgres:postgres@", "jobsearch_app:jobsearch_app@")
  );
}

test("siembra, mide y limpia", async () => {
  await clean();
  const totals = await seed();
  const url = appUrl();
  assertLocalTestDatabase(url);
  const conn = postgres(url, { max: 1, prepare: false });
  const ownerUrl = url.replace("jobsearch_app:jobsearch_app@", "postgres:postgres@");
  assertLocalTestDatabase(ownerUrl);
  const ownerConn = postgres(ownerUrl, { max: 1, prepare: false });
  const filas: { nombre: string; ms: number | null; error?: string; plan: string }[] = [];
  try {
    for (const caso of CASOS) {
      let ms: number | null = null;
      let plan = "";
      let error: string | undefined;
      try {
        // Dos pasadas: la primera calienta la caché, la segunda es la que se informa
        for (let pasada = 0; pasada < 2; pasada++) {
          const lineas = await (caso.owner ? ownerConn : conn).begin(async (tx) => {
            await tx`select set_config('app.user_id', ${uid(caso.usuario)}, true)`;
            await tx`set local statement_timeout = '60s'`;
            const rows = await tx.unsafe(`explain (analyze, buffers) ${caso.consulta}`);
            return rows.map((r) => String(r["QUERY PLAN"]));
          });
          plan = lineas.join("\n");
          const m = /Execution Time: ([\d.]+) ms/.exec(plan);
          ms = m ? Number(m[1]) : null;
        }
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 160) : "error";
      }
      filas.push({ nombre: caso.nombre, ms, ...(error ? { error } : {}), plan });
    }
  } finally {
    await conn.end();
    await ownerConn.end();
    await clean();
  }

  const lentas = filas.filter((f) => (f.ms ?? 0) > 50 || f.error);
  const lineas: string[] = [];
  lineas.push("# Resultado crudo de la medición (R28-13)");
  lineas.push("");
  lineas.push(
    `Base local, sembrada con ${PEOPLE} personas inventadas, ${totals.jobs} ofertas, ${totals.evaluations} evaluaciones, ${totals.applications} postulaciones y ${PEOPLE * 100} llamadas de IA (persona pesada: ${HEAVY}). Rol \`jobsearch_app\` con RLS. Segunda pasada de cada consulta.`,
  );
  lineas.push("");
  lineas.push("| Consulta | ms | > 50 ms |");
  lineas.push("| --- | ---: | :---: |");
  for (const f of filas) {
    lineas.push(
      `| ${f.nombre} | ${f.error ? "ERROR" : (f.ms ?? "?")} | ${(f.ms ?? 0) > 50 || f.error ? "sí" : ""} |`,
    );
  }
  lineas.push("");
  for (const f of lentas) {
    lineas.push(`## ${f.nombre}`);
    lineas.push("");
    if (f.error) lineas.push(`Error: ${f.error}`);
    lineas.push("```");
    lineas.push(f.plan.split("\n").slice(0, 60).join("\n"));
    lineas.push("```");
    lineas.push("");
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, "consultas-resultado.md"), lineas.join("\n"), "utf8");
});
