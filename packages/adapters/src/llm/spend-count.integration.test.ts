import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countTaskCallsSince } from "./spend";

/** Conteo por tarea y persona (R6-3, S2) contra Postgres real, con datos ficticios. */
const NOW = new Date("2026-11-12T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const TASK = "extract_job_from_image";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const call = (over: Partial<typeof s.llmCalls.$inferInsert>) => ({
  userId: USER,
  task: TASK,
  model: "modelo-ficticio",
  ok: true,
  createdAt: new Date(NOW.getTime() - 3_600_000),
  ...over,
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
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db.delete(s.llmCalls);
  await conn.db.insert(s.llmCalls).values([
    call({}),
    call({}),
    call({ ok: false, costUsd: null, error: "timeout" }),
    call({ ok: false, costUsd: null, error: "timeout" }),
    call({ ok: false, costUsd: null, error: "timeout" }),
    // No cuentan: otra persona, otra tarea, fuera de la ventana de 24 h
    call({ userId: OTHER }),
    call({ task: "evaluate_job" }),
    call({ createdAt: new Date(NOW.getTime() - 25 * 3_600_000) }),
  ]);
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("countTaskCallsSince", () => {
  const since = new Date(NOW.getTime() - 24 * 3_600_000);

  it("con onlyOk cuenta solo las que respondieron (el cupo de 10 no se gasta con fallos)", async () => {
    expect(
      await countTaskCallsSince(conn.db, { userId: USER, task: TASK, since, onlyOk: true }),
    ).toBe(2);
  });

  it("sin onlyOk cuenta todos los intentos, también los fallidos (segundo tope)", async () => {
    expect(await countTaskCallsSince(conn.db, { userId: USER, task: TASK, since })).toBe(5);
  });
});
