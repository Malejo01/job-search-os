import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, type Db } from "@job-search-os/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteInterviewSession, listInterviewScores } from "./store";

/**
 * Borrar una simulación y leer la evolución por el camino real de la app (rol jobsearch_app, sin BYPASSRLS, con
 * app.user_id por transacción). La policy `FOR ALL` de 0045/0046 ya cubre el DELETE: no hace falta migración.
 * Datos inventados.
 */
const A = "a0000000-0000-4000-8000-0000000023a1";
const B = "a0000000-0000-4000-8000-0000000023b2";
const APP_PASSWORD = "jobsearch_app_test";
const QUESTIONS = JSON.stringify([
  "P1 ficticia",
  "P2 ficticia",
  "P3 ficticia",
  "P4 ficticia",
  "P5 ficticia",
]);

let container: StartedPostgreSqlContainer | null = null;
let owner: ReturnType<typeof createDb>;
let app: ReturnType<typeof createDb>;

async function asUser<T>(userId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return app.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx as unknown as Db);
  });
}

async function seedSession(
  userId: string,
  status: "terminada" | "en_curso",
  scores: number[],
  createdAt: string,
): Promise<string> {
  const rows = (await owner.db.execute(sql`
    insert into interview_sessions (user_id, source_kind, career, seniority, title, questions, status, created_at)
    values (${userId}::uuid, 'career', 'Analista de datos', 'junior', 'Simulación ficticia',
            ${QUESTIONS}::text::jsonb, ${status}, ${createdAt}::timestamptz)
    returning id`)) as unknown as { id: string }[];
  const id = rows[0]!.id;
  for (const [position, v] of scores.entries()) {
    await owner.db.execute(sql`
      insert into interview_answers (session_id, user_id, position, answer, clarity, relevance, star, tip, example)
      values (${id}::uuid, ${userId}::uuid, ${position}, 'Respuesta ficticia', ${v}, ${v}, ${v}, 'Consejo', 'Ejemplo')`);
  }
  return id;
}

async function count(
  table: "interview_sessions" | "interview_answers",
  id: string,
): Promise<number> {
  const col = table === "interview_sessions" ? "id" : "session_id";
  const rows = (await owner.db.execute(
    sql.raw(`select count(*)::int as n from ${table} where ${col} = '${id}'`),
  )) as unknown as { n: number }[];
  return rows[0]!.n;
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
  owner = createDb(ownerUrl, { max: 1 });
  await owner.db.execute(sql.raw(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`));
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = createDb(u.toString(), { max: 1 });
  for (const [id, mail] of [
    [A, "a-progreso@example.com"],
    [B, "b-progreso@example.com"],
  ] as const) {
    await owner.db.execute(
      sql`insert into users (id, email, password_hash) values (${id}::uuid, ${mail}, 'x') on conflict do nothing`,
    );
  }
}, 180_000);

afterAll(async () => {
  await owner?.db.execute(sql`delete from users where id in (${A}::uuid, ${B}::uuid)`);
  await app?.close();
  await owner?.close();
  await container?.stop();
});

describe("evolución de los puntajes", () => {
  it("solo cuenta simulaciones terminadas de la persona, con el promedio de cada criterio", async () => {
    await seedSession(A, "terminada", [4, 4, 4, 4, 4], "2026-11-01T10:00:00Z");
    await seedSession(A, "terminada", [6, 7, 8, 7, 7], "2026-11-02T10:00:00Z");
    await seedSession(A, "en_curso", [9, 9], "2026-11-03T10:00:00Z");
    await seedSession(B, "terminada", [10, 10, 10, 10, 10], "2026-11-04T10:00:00Z");
    const scores = await asUser(A, (db) => listInterviewScores(db, A));
    expect(scores).toHaveLength(2);
    // Las más recientes primero
    expect(scores[0]?.clarity).toBeCloseTo(7, 5);
    expect(scores[1]?.clarity).toBeCloseTo(4, 5);
  });
});

describe("borrar una simulación", () => {
  it("la persona borra la suya y caen sus respuestas", async () => {
    const id = await seedSession(A, "terminada", [5, 5, 5, 5, 5], "2026-11-05T10:00:00Z");
    expect(await count("interview_answers", id)).toBe(5);
    expect(await asUser(A, (db) => deleteInterviewSession(db, A, id))).toBe(true);
    expect(await count("interview_sessions", id)).toBe(0);
    expect(await count("interview_answers", id)).toBe(0);
  });

  it("no puede borrar la de otra persona, ni pasando su user_id: no pasa nada", async () => {
    const idB = await seedSession(B, "terminada", [5, 5, 5, 5, 5], "2026-11-06T10:00:00Z");
    expect(await asUser(A, (db) => deleteInterviewSession(db, A, idB))).toBe(false);
    expect(await asUser(A, (db) => deleteInterviewSession(db, B, idB))).toBe(false);
    expect(await count("interview_sessions", idB)).toBe(1);
    expect(await count("interview_answers", idB)).toBe(5);
  });

  it("sin persona fijada no borra nada", async () => {
    const id = await seedSession(A, "en_curso", [5], "2026-11-07T10:00:00Z");
    const deleted = await app.db.transaction((tx) =>
      deleteInterviewSession(tx as unknown as Db, A, id),
    );
    expect(deleted).toBe(false);
    expect(await count("interview_sessions", id)).toBe(1);
  });

  it("un id que no existe da false", async () => {
    expect(
      await asUser(A, (db) =>
        deleteInterviewSession(db, A, "a0000000-0000-4000-8000-00000000dead"),
      ),
    ).toBe(false);
  });
});
