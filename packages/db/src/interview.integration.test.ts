import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * Simulador de entrevistas: RLS de `interview_sessions` e `interview_answers` por el camino real (la app se
 * conecta como jobsearch_app, NOBYPASSRLS, con app.user_id fijado), restricciones de las tablas y borrado en
 * cascada con la cuenta. Datos inventados.
 */
const A = "a9000000-0000-4000-8000-000000000001";
const B = "b9000000-0000-4000-8000-000000000002";
const APP_PASSWORD = "jobsearch_app_test";
const QUESTIONS = JSON.stringify([
  "P1 ficticia",
  "P2 ficticia",
  "P3 ficticia",
  "P4 ficticia",
  "P5 ficticia",
]);

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;
let app: Sql;
let sessionA: string;
let sessionB: string;
let jobA: string;

async function asUser<T>(userId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return (await app.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL app.user_id = '${userId}'`);
    return fn(tx);
  })) as T;
}

async function newSession(userId: string, jobId: string | null = null): Promise<string> {
  const [s] = await owner<{ id: string }[]>`
    insert into interview_sessions (user_id, source_kind, job_id, career, seniority, title, questions)
    values (${userId}, ${jobId ? "job" : "career"}, ${jobId}, ${jobId ? null : "Analista de datos"},
            ${jobId ? null : "junior"}, 'Simulación ficticia', ${QUESTIONS}::text::jsonb)
    returning id`;
  return s!.id;
}

const answerValues = (sessionId: string, userId: string, position: number) => ({
  session_id: sessionId,
  user_id: userId,
  position,
});

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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner.unsafe(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`);
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = postgres(u.toString(), { max: 4, prepare: false });

  await owner`insert into users (id, email, password_hash) values (${A}, 'a-entrevista@dos.test', 'x')`;
  await owner`insert into users (id, email, password_hash) values (${B}, 'b-entrevista@dos.test', 'x')`;
  const [job] = await owner<{ id: string }[]>`
    insert into jobs (user_id, company_raw, title, title_normalized)
    values (${A}, 'Empresa A', 'Analista', 'analista') returning id`;
  jobA = job!.id;
  sessionA = await newSession(A, jobA);
  sessionB = await newSession(B);
  await owner`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
               values (${sessionA}, ${A}, 0, 'Respuesta de A', 7, 8, 4, 'Consejo', 'Ejemplo')`;
  await owner`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
               values (${sessionB}, ${B}, 0, 'Respuesta de B', 5, 5, 5, 'Consejo', 'Ejemplo')`;
}, 180_000);

afterAll(async () => {
  await owner?.unsafe(`delete from users where id in ('${A}', '${B}')`);
  await app?.end();
  await owner?.end();
  await container?.stop();
});

describe("RLS multiusuario del simulador", () => {
  it("una persona ve solo sus simulaciones y sus respuestas", async () => {
    const sessions = await asUser(
      A,
      (tx) => tx<{ id: string }[]>`select id from interview_sessions`,
    );
    expect(sessions.map((r) => r.id)).toEqual([sessionA]);
    const answers = await asUser(
      A,
      (tx) => tx<{ answer: string }[]>`select answer from interview_answers`,
    );
    expect(answers.map((r) => r.answer)).toEqual(["Respuesta de A"]);
  });

  it("sin persona fijada no ve nada", async () => {
    const rows = await app.begin((tx) => tx`select id from interview_sessions`);
    expect(rows).toHaveLength(0);
  });

  it("no puede editar ni borrar lo de otra persona", async () => {
    const upd = await asUser(
      A,
      (tx) => tx`update interview_sessions set status = 'terminada' where id = ${sessionB}`,
    );
    expect(upd.count).toBe(0);
    const del = await asUser(
      A,
      (tx) => tx`delete from interview_answers where session_id = ${sessionB}`,
    );
    expect(del.count).toBe(0);
    const [still] = await owner<
      { n: number }[]
    >`select count(*)::int as n from interview_answers where session_id = ${sessionB}`;
    expect(still!.n).toBe(1);
  });

  it("no puede crear una simulación a nombre de otra persona", async () => {
    await expect(
      asUser(
        A,
        (
          tx,
        ) => tx`insert into interview_sessions (user_id, source_kind, career, seniority, title, questions)
                   values (${B}, 'career', 'Analista', 'junior', 'Ajena', ${QUESTIONS}::text::jsonb)`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("no puede colgar respuestas de la simulación de otra persona, ni con su propio user_id", async () => {
    const v = answerValues(sessionB, A, 1);
    await expect(
      asUser(
        A,
        (
          tx,
        ) => tx`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
                   values (${v.session_id}, ${v.user_id}, ${v.position}, 'Intruso', 5, 5, 5, 'Consejo', 'Ejemplo')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("sí puede guardar respuestas en su propia simulación", async () => {
    const v = answerValues(sessionA, A, 1);
    const ins = await asUser(
      A,
      (
        tx,
      ) => tx`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
                 values (${v.session_id}, ${v.user_id}, ${v.position}, 'Segunda respuesta', 6, 6, 6, 'Consejo', 'Ejemplo')`,
    );
    expect(ins.count).toBe(1);
  });
});

describe("restricciones", () => {
  it("rechaza puntajes fuera de 0 a 10", async () => {
    await expect(
      owner`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
            values (${sessionA}, ${A}, 3, 'R', 11, 5, 5, 'c', 'e')`,
    ).rejects.toThrow(/interview_answers_scores/);
  });

  it("rechaza una posición repetida en la misma simulación", async () => {
    await expect(
      owner`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
            values (${sessionA}, ${A}, 0, 'R', 5, 5, 5, 'c', 'e')`,
    ).rejects.toThrow(/interview_answers_session_position/);
  });

  it("rechaza una simulación que no tenga exactamente cinco preguntas", async () => {
    await expect(
      owner`insert into interview_sessions (user_id, source_kind, career, seniority, title, questions)
            values (${A}, 'career', 'Analista', 'junior', 'Corta', ${JSON.stringify(["una", "dos"])}::text::jsonb)`,
    ).rejects.toThrow(/interview_sessions_questions/);
  });
});

describe("borrado en cascada", () => {
  it("al borrar la oferta la simulación queda sin enlace y con su título", async () => {
    await owner`delete from jobs where id = ${jobA}`;
    const [s] = await owner<{ job_id: string | null; title: string }[]>`
      select job_id, title from interview_sessions where id = ${sessionA}`;
    expect(s).toEqual({ job_id: null, title: "Simulación ficticia" });
  });

  it("al borrar la simulación caen sus respuestas", async () => {
    const tmp = await newSession(B);
    await owner`insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
                values (${tmp}, ${B}, 0, 'R', 5, 5, 5, 'c', 'e')`;
    await owner`delete from interview_sessions where id = ${tmp}`;
    const [r] = await owner<
      { n: number }[]
    >`select count(*)::int as n from interview_answers where session_id = ${tmp}`;
    expect(r!.n).toBe(0);
  });

  it("al borrar la cuenta caen simulaciones y respuestas, y solo las de esa persona", async () => {
    await owner`delete from users where id = ${A}`;
    const [a] = await owner<{ s: number; a: number }[]>`
      select (select count(*) from interview_sessions where user_id = ${A})::int as s,
             (select count(*) from interview_answers where user_id = ${A})::int as a`;
    expect(a).toEqual({ s: 0, a: 0 });
    const [b] = await owner<{ s: number; a: number }[]>`
      select (select count(*) from interview_sessions where user_id = ${B})::int as s,
             (select count(*) from interview_answers where user_id = ${B})::int as a`;
    expect(b).toEqual({ s: 1, a: 1 });
  });
});
