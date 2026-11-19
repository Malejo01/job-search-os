import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { and, eq, gte, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OVERSIZE_UNEXPECTED_REASON,
  PROCESSING_UNEXPECTED_REASON,
  SECURITY_EMAIL_REASON,
  UNEXPECTED_SENDER_REASON,
} from "./inbound/handle";
import { POOL_PARSER } from "./inbound/pool-mailbox";
import { LLM_RESERVE_TASK, spendSinceQuery } from "./llm/spend";
import { liveReservationsQuery } from "./llm/spend-reserve";
import { PROFILE_AGENT_SPEND_TASKS } from "./profile-agent/measure";
import {
  answerBankUsageQuery,
  applicationAnswersUsageQuery,
  personRawBytesQuery,
} from "./quota/person-quota";
import { loginAttemptsPurgeBatchSql } from "./retention/purge";

/**
 * Consultas calientes de las tablas que crecen (llm_calls, inbound_emails, raw_blobs, answer_bank,
 * application_answers, login_attempts): con miles de filas y ANALYZE, el plan no puede recorrer la tabla grande
 * entera (Seq Scan). Datos inventados. Cada consulta sale de la función que la exporta o, si no existe, se
 * reproduce con un comentario que dice de dónde viene.
 *
 * Las consultas de la persona (cuotas sobre raw_blobs, answer_bank y application_answers) corren en la app con
 * RLS, así que se miden como `jobsearch_app` con `app.user_id` puesto. Las de servicio (gasto, cupos de correo)
 * se miden como dueño, que es como corren.
 *
 * Una consulta con `pending` es una brecha conocida: se mide y se informa, pero no falla (ver
 * ops/rondas/s3-tanda/rendimiento-explain.md). Cuando se cierra la brecha se le saca el `pending`.
 */
const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date();
const SINCE_24H = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const BIG_TABLES = new Set([
  "llm_calls",
  "inbound_emails",
  "raw_blobs",
  "answer_bank",
  "application_answers",
  "login_attempts",
  "jobs",
  "job_sources",
]);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

// Un drizzle sin conexión alcanza para armar el SQL con `toSQL()`: nunca ejecuta nada (postgres.js conecta
// recién con la primera consulta). Por eso puede crearse al cargar el módulo, antes de que exista la base.
const builder = createDb("postgres://nadie@localhost:1/nadie").db;
const conn$ = () => builder;

/** uuid de la persona número `n` (1 a 200), como expresión SQL sobre el entero `i`. */
const uidSql = (i: string) =>
  `('00000000-0000-4000-8000-' || lpad(to_hex(1 + (${i} % 200)), 12, '0'))::uuid`;
const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(", ");

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
  conn = createDb(ownerUrl, { max: 1 });
  const run = (text: string) => conn.sql.unsafe(text);

  await run(
    "truncate llm_calls, inbound_emails, inbound_sender_domains, raw_blobs, answer_bank, application_answers, job_sources, jobs, login_attempts cascade",
  );

  // llm_calls: 30.000 filas repartidas en 60 días (la ventana de 24 h es ~2 %), mezcla de tareas y de personas
  const tasks = [
    "evaluate_job",
    "assistant",
    "extract_job_from_image",
    ...PROFILE_AGENT_SPEND_TASKS.slice(0, 3),
    "cv_reserve",
  ];
  await run(`
    insert into llm_calls (user_id, task, model, ok, cost_usd, tokens_out, error, created_at)
    select ${uidSql("i")}, (array[${quoted(tasks)}])[1 + i % ${tasks.length}], 'modelo-ficticio',
           i % 17 <> 0, 0.001, 100, case when i % 17 = 0 then 'timeout' end,
           now() - ((i * 7919) % 86400) * interval '1 minute'
      from generate_series(1, 30000) i`);
  // Reservas de gasto: pocas, casi todas viejas; tres vivas
  await run(`
    insert into llm_calls (user_id, task, model, ok, tokens_out, created_at)
    select ${uidSql("i")}, '${LLM_RESERVE_TASK}', 'none', true, 50000,
           now() - ((i * 104729) % 86400) * interval '1 minute'
      from generate_series(1, 600) i`);
  await run(`
    insert into llm_calls (user_id, task, model, ok, tokens_out, created_at)
    select ${uidSql("i")}, '${LLM_RESERVE_TASK}', 'none', true, 50000, now() - interval '1 minute'
      from generate_series(1, 3) i`);

  // inbound_emails: 20.000 de personas (100 cada una) y 3.000 del buzón del pool (sin persona)
  const reasons = [
    UNEXPECTED_SENDER_REASON,
    SECURITY_EMAIL_REASON,
    OVERSIZE_UNEXPECTED_REASON,
    PROCESSING_UNEXPECTED_REASON,
  ];
  await run(`
    insert into inbound_emails (user_id, from_address, raw_ref, email_id, parser, error, received_at)
    select ${uidSql("i")}, 'alertas@portal-a.example', 'pg:' || i, 'em_' || i, 'generic',
           case when i % 5 = 0 then (array[${quoted(reasons)}])[1 + i % ${reasons.length}] end,
           now() - ((i * 6151) % 86400) * interval '1 minute'
      from generate_series(1, 20000) i`);
  await run(`
    insert into inbound_emails (user_id, from_address, raw_ref, email_id, parser, received_at)
    select null, 'alertas@portal-b.example', 'pg:p' || i, 'emp_' || i, '${POOL_PARSER}',
           now() - ((i * 6151) % 86400) * interval '1 minute'
      from generate_series(1, 3000) i`);
  await run(`
    insert into inbound_sender_domains (user_id, domain, verdict)
    select ${uidSql("i")}, 'dominio-' || i || '.example', 'empleo' from generate_series(1, 2000) i`);

  // raw_blobs: 15.000 crudos de 200 personas, mezcla de los que cuentan para la cuota y los de correo
  const kinds = ["inbound_email", "ingest_email_generic", "jd_paste", "image", "jd_paste"];
  await run(`
    insert into raw_blobs (user_id, kind, content_type, body, bytes, created_at)
    select ${uidSql("i")}, (array[${quoted(kinds)}])[1 + i % ${kinds.length}], 'text/plain', 'x', 1000 + i % 5000,
           now() - ((i * 3571) % 86400) * interval '1 minute'
      from generate_series(1, 15000) i`);

  // answer_bank (50 por persona), jobs (30 por persona), job_sources manuales y application_answers (3 por oferta)
  await run(`
    insert into answer_bank (user_id, question, question_normalized, answer, lang)
    select ${uidSql("i")}, 'Pregunta ' || i, 'pregunta ' || i, 'Respuesta ' || i, 'es'
      from generate_series(1, 10000) i`);
  await run(`
    insert into jobs (user_id, company_raw, title, title_normalized)
    select ${uidSql("i")}, 'Empresa A', 'Puesto ' || i, 'puesto ' || i from generate_series(1, 6000) i`);
  await run(`
    insert into job_sources (job_id, kind, source_name)
    select id, 'manual', 'manual' from jobs`);
  await run(`
    insert into application_answers (user_id, job_id, position, question, answer)
    select j.user_id, j.id, p, 'Pregunta ' || p, 'Respuesta ' || p
      from jobs j cross join generate_series(1, 3) p`);

  // login_attempts: 20.000 filas casi todas del último día (la purga diaria deja pocas viejas)
  await run(`
    insert into login_attempts (email_hash, failed_count, last_attempt_at)
    select md5(i::text) || md5((i + 1)::text), 1,
           case when i % 50 = 0 then now() - interval '3 days'
                else now() - ((i * 37) % 1440) * interval '1 minute' end
      from generate_series(1, 20000) i`);

  await run(
    "analyze llm_calls, inbound_emails, inbound_sender_domains, raw_blobs, answer_bank, application_answers, job_sources, jobs, login_attempts",
  );
}, 300_000);

afterAll(async () => {
  await conn?.sql
    .unsafe(
      "truncate llm_calls, inbound_emails, inbound_sender_domains, raw_blobs, answer_bank, application_answers, job_sources, jobs, login_attempts cascade",
    )
    .catch(() => undefined);
  await conn?.close();
  await container?.stop();
});

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};

/** EXPLAIN (sin ejecutar) de una consulta con sus parámetros; `asUser` la corre como la app con RLS. */
async function explain(
  text: string,
  params: unknown[],
  asUser?: string,
): Promise<{ scans: string[]; seqScansOnBig: string[]; summary: string }> {
  const raw = await conn.sql.begin(async (tx) => {
    if (asUser) {
      await tx.unsafe("set local role jobsearch_app");
      await tx.unsafe(`select set_config('app.user_id', '${asUser}', true)`);
    }
    return tx.unsafe(`explain (format json) ${text}`, params as never[]);
  });
  const root = (raw[0] as unknown as { "QUERY PLAN": { Plan: PlanNode }[] })["QUERY PLAN"][0]!.Plan;
  const scans: string[] = [];
  const seqScansOnBig: string[] = [];
  const walk = (node: PlanNode) => {
    const kind = node["Node Type"];
    if (node["Relation Name"]) {
      scans.push(
        `${kind} ${node["Relation Name"]}${node["Index Name"] ? ` (${node["Index Name"]})` : ""}`,
      );
      if (kind === "Seq Scan" && BIG_TABLES.has(node["Relation Name"])) {
        seqScansOnBig.push(node["Relation Name"]);
      }
    } else if (node["Index Name"]) {
      // Bitmap Index Scan: el índice con el que se arma el mapa de la tabla
      scans.push(`${kind} (${node["Index Name"]})`);
    }
    node.Plans?.forEach(walk);
  };
  walk(root);
  return { scans, seqScansOnBig, summary: scans.join(" + ") };
}

type HotQuery = {
  name: string;
  /** Texto SQL con `$n`, y sus parámetros. */
  build: () => { sql: string; params: unknown[] };
  asUser?: string;
  /** Brecha conocida: se informa pero no falla. */
  pending?: string;
};

const fromBuilder = (q: { toSQL: () => { sql: string; params: unknown[] } }) => () => q.toSQL();
const raw =
  (text: string, params: unknown[] = []) =>
  () => ({ sql: text, params });

const QUERIES: HotQuery[] = [
  // --- Gasto (spend.ts) ---
  {
    name: "gasto 24 h global (spendSinceQuery)",
    build: fromBuilder(spendSinceQuery(conn$(), SINCE_24H)),
  },
  {
    name: "gasto 24 h global sin agente de CV (spendSinceQuery, excludeCvAgent: NOT IN de S3-10)",
    build: fromBuilder(spendSinceQuery(conn$(), SINCE_24H, { excludeCvAgent: true })),
  },
  {
    name: "gasto 24 h de una persona (spendSinceQuery, userId)",
    build: fromBuilder(spendSinceQuery(conn$(), SINCE_24H, { userId: USER })),
  },
  {
    name: "gasto 24 h de una persona sin agente de CV (userId + excludeCvAgent)",
    build: fromBuilder(spendSinceQuery(conn$(), SINCE_24H, { userId: USER, excludeCvAgent: true })),
  },
  {
    // countTaskCallsSince (spend.ts) ejecuta directo y no expone la consulta: se reproduce igual
    name: "llamadas de una tarea por persona (countTaskCallsSince, reproducida)",
    build: fromBuilder(
      conn$()
        .select({ n: sql<number>`count(*)::int` })
        .from(s.llmCalls)
        .where(
          and(
            eq(s.llmCalls.userId, USER),
            eq(s.llmCalls.task, "extract_job_from_image"),
            gte(s.llmCalls.createdAt, SINCE_24H),
            eq(s.llmCalls.ok, true),
          ),
        ),
    ),
  },
  // --- Reservas de gasto (spend-reserve.ts) ---
  {
    name: "reservas vivas, todas (liveReservationsQuery)",
    build: fromBuilder(liveReservationsQuery(conn$(), NOW)),
  },
  {
    name: "reservas vivas de una persona (liveReservationsQuery, userId)",
    build: fromBuilder(liveReservationsQuery(conn$(), NOW, { userId: USER })),
  },
  {
    // releaseLlmSpend (spend-reserve.ts): DELETE por id y tarea
    name: "borrar una reserva (releaseLlmSpend, reproducida)",
    build: raw(`delete from llm_calls where id = $1 and task = $2`, [
      "00000000-0000-4000-8000-0000000000ff",
      LLM_RESERVE_TASK,
    ]),
  },
  // --- login_attempts (rls/0029 y rls/0028, retention/purge.ts) ---
  {
    name: "login begin: fila por email (SELECT ... FOR UPDATE por email_hash, rls/0029)",
    build: raw(
      `select failed_count, locked_until, last_attempt_at from login_attempts where email_hash = $1 for update`,
      ["a".repeat(64)],
    ),
  },
  {
    name: "login begin: actualizar el contador (UPDATE por email_hash, rls/0029)",
    build: raw(
      `update login_attempts set failed_count = 1, last_attempt_at = now() where email_hash = $1`,
      ["a".repeat(64)],
    ),
  },
  {
    name: "login begin: alta de la fila (INSERT ON CONFLICT, rls/0029)",
    build: raw(
      `insert into login_attempts (email_hash) values ($1) on conflict (email_hash) do nothing`,
      ["b".repeat(64)],
    ),
  },
  {
    // rls/0028: login_attempt_clear borra por el prefijo de 32 caracteres con left(), que no usa el índice de la clave
    name: "login clear: borrar todos los intentos de un email (left(email_hash, 32), rls/0028)",
    build: raw(`delete from login_attempts a where left(a.email_hash, 32) = left($1::text, 32)`, [
      "c".repeat(64),
    ]),
  },
  {
    // retention/purge.ts: el SQL real de un lote de la purga diaria
    name: "login purga: lote de filas viejas (loginAttemptsPurgeBatchSql)",
    build: () => {
      const { sql: text, params } = new PgDialect().sqlToQuery(
        loginAttemptsPurgeBatchSql(SINCE_24H, 500),
      );
      return { sql: text, params };
    },
  },
  // --- Cupos de inbound_emails (inbound/handle.ts: checkUserQuota, no exportada: se reproduce) ---
  {
    name: "cupo de correo, remitente esperado (checkUserQuota, reproducida)",
    build: fromBuilder(
      conn$()
        .select({
          hour: sql<number>`count(*) filter (where ${s.inboundEmails.receivedAt} >= ${new Date(NOW.getTime() - 3_600_000).toISOString()}::timestamptz)::int`,
          day: sql<number>`count(*)::int`,
        })
        .from(s.inboundEmails)
        .where(
          and(
            eq(s.inboundEmails.userId, USER),
            gte(s.inboundEmails.receivedAt, SINCE_24H),
            or(
              isNull(s.inboundEmails.error),
              notInArray(s.inboundEmails.error, [
                UNEXPECTED_SENDER_REASON,
                SECURITY_EMAIL_REASON,
                OVERSIZE_UNEXPECTED_REASON,
                PROCESSING_UNEXPECTED_REASON,
              ]),
            ),
          ),
        ),
    ),
  },
  {
    name: "cupo de correo, remitente no esperado (checkUserQuota, reproducida)",
    build: fromBuilder(
      conn$()
        .select({
          hour: sql<number>`count(*) filter (where ${s.inboundEmails.receivedAt} >= ${new Date(NOW.getTime() - 3_600_000).toISOString()}::timestamptz)::int`,
          day: sql<number>`count(*)::int`,
        })
        .from(s.inboundEmails)
        .where(
          and(
            eq(s.inboundEmails.userId, USER),
            gte(s.inboundEmails.receivedAt, SINCE_24H),
            inArray(s.inboundEmails.error, [
              UNEXPECTED_SENDER_REASON,
              SECURITY_EMAIL_REASON,
              OVERSIZE_UNEXPECTED_REASON,
              PROCESSING_UNEXPECTED_REASON,
            ]),
          ),
        ),
    ),
  },
  {
    name: "cupo de correo: dominios de empleo de la persona (checkUserQuota, reproducida)",
    build: fromBuilder(
      conn$()
        .select({ domain: s.inboundSenderDomains.domain })
        .from(s.inboundSenderDomains)
        .where(
          and(
            eq(s.inboundSenderDomains.userId, USER),
            eq(s.inboundSenderDomains.verdict, "empleo"),
          ),
        ),
    ),
  },
  {
    // handle.ts: cupo del buzón compartido del pool (user_id null + parser)
    name: "cupo del buzón del pool (user_id null y parser, reproducida)",
    build: fromBuilder(
      conn$()
        .select({
          hour: sql<number>`count(*) filter (where ${s.inboundEmails.receivedAt} >= ${new Date(NOW.getTime() - 3_600_000).toISOString()}::timestamptz)::int`,
          day: sql<number>`count(*)::int`,
        })
        .from(s.inboundEmails)
        .where(
          and(
            isNull(s.inboundEmails.userId),
            eq(s.inboundEmails.parser, POOL_PARSER),
            gte(s.inboundEmails.receivedAt, SINCE_24H),
          ),
        ),
    ),
  },
  // --- Cuota por persona (quota/person-quota.ts), como la app con RLS ---
  {
    name: "cuota de espacio: bytes de raw_blobs de la persona (personRawBytesQuery)",
    build: fromBuilder(personRawBytesQuery(conn$(), USER)),
    asUser: USER,
  },
  {
    // reservePersonQuota (person-quota.ts): conteo de ofertas manuales, inline: se reproduce
    name: "cuota de ofertas manuales (reservePersonQuota, reproducida)",
    build: fromBuilder(
      conn$()
        .select({ n: sql<number>`count(distinct ${s.jobSources.jobId})::int` })
        .from(s.jobSources)
        .innerJoin(s.jobs, eq(s.jobs.id, s.jobSources.jobId))
        .where(
          and(
            eq(s.jobs.userId, USER),
            eq(s.jobSources.kind, "manual"),
            eq(s.jobSources.sourceName, "manual"),
          ),
        ),
    ),
    asUser: USER,
  },
  {
    name: "cuota de respuestas guardadas: answer_bank de la persona (answerBankUsageQuery)",
    build: fromBuilder(answerBankUsageQuery(conn$(), USER)),
    asUser: USER,
  },
  {
    name: "cuota de formularios: application_answers de la persona (applicationAnswersUsageQuery)",
    build: fromBuilder(
      applicationAnswersUsageQuery(conn$(), USER, "00000000-0000-4000-8000-0000000000ff"),
    ),
    asUser: USER,
  },
];

describe("consultas calientes: sin Seq Scan sobre la tabla grande", () => {
  // Una sola salida al final: de ahí se arma la tabla de ops/rondas/s3-tanda/rendimiento-explain.md
  const report: string[] = [];
  afterAll(() => {
    console.log(`\n${report.join("\n")}\n`);
  });

  for (const q of QUERIES) {
    it(`${q.name}${q.pending ? " [pendiente]" : ""}`, async () => {
      const { sql: text, params } = q.build();
      const plan = await explain(text, params, q.asUser);
      report.push(
        `PLAN | ${q.name} | ${plan.summary || "(sin tabla)"} | ${
          plan.seqScansOnBig.length > 0
            ? `SEQ SCAN: ${plan.seqScansOnBig.join(", ")}`
            : "sin Seq Scan"
        }${q.pending ? " | PENDIENTE" : ""}`,
      );
      if (q.pending) return;
      expect(plan.seqScansOnBig, `${q.name}: ${plan.summary}`).toEqual([]);
    });
  }
});
