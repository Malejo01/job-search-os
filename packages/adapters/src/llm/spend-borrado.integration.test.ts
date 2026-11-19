import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, deleteUserData, schema as s } from "@job-search-os/db";
import { eq, inArray, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spendLast24h } from "./spend";

/** El gasto ya hecho sigue contando después de borrar la cuenta. Datos inventados. */
const A = "a3200000-0000-4000-8000-000000000001";
const B = "b3200000-0000-4000-8000-000000000002";
const JOB = "c3200000-0000-4000-8000-000000000003";
const APP_PASSWORD = "jobsearch_app_test";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let appConn: ReturnType<typeof createDb>;

async function deleteAccountOf(userId: string): Promise<Record<string, number>> {
  return appConn.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return deleteUserData(tx as never, userId);
  });
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
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db.execute(sql.raw(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`));
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  appConn = createDb(u.toString(), { max: 1 });
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls).where(inArray(s.llmCalls.task, ["evaluate_job"]));
  await conn.db.delete(s.users).where(inArray(s.users.id, [A, B]));
  await conn.db.insert(s.users).values([
    { id: A, email: "borrado-a@example.com" },
    { id: B, email: "borrado-b@example.com" },
  ]);
  await conn.db.insert(s.llmCalls).values([
    {
      userId: A,
      task: "evaluate_job",
      model: "modelo-falso",
      jobId: JOB,
      label: "conv:charla-de-prueba",
      error: "detalle de la llamada",
      costUsd: 0.4,
      ok: false,
    },
    { userId: B, task: "evaluate_job", model: "modelo-falso", costUsd: 0.1, ok: true },
  ]);
});

afterAll(async () => {
  await conn?.db.delete(s.llmCalls).where(eq(s.llmCalls.task, "evaluate_job"));
  await conn?.db.delete(s.users).where(inArray(s.users.id, [A, B]));
  await appConn?.close();
  await conn?.close();
  await container?.stop();
});

describe("gasto de una cuenta borrada", () => {
  it("borrar una cuenta no baja el gasto de las últimas 24 horas", async () => {
    const before = await spendLast24h(conn.db);
    await deleteAccountOf(A);
    const after = await spendLast24h(conn.db);
    expect(after.usd).toBeCloseTo(before.usd, 6);
  });

  it("la fila queda sin datos que identifiquen a la persona", async () => {
    await deleteAccountOf(A);
    const rows = await conn.db
      .select()
      .from(s.llmCalls)
      .where(eq(s.llmCalls.task, "evaluate_job"));
    const anonymous = rows.filter((r) => r.userId === null);
    expect(anonymous).toHaveLength(1);
    expect(anonymous[0]).toMatchObject({ jobId: null, label: null, error: null });
    expect(anonymous[0]!.costUsd).toBeCloseTo(0.4, 6);
  });

  it("las filas de las demás personas no cambian", async () => {
    await deleteAccountOf(A);
    const rows = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.userId, B));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.costUsd).toBeCloseTo(0.1, 6);
  });

  it("nadie puede anonimizar el gasto de otra cuenta", async () => {
    const attempt = appConn.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${B}, true)`);
      await tx.execute(sql`select anonymize_llm_calls(${A}::uuid)`);
    });
    await expect(attempt).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringMatching(/solo la cuenta propia/) }),
    });
    const rows = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.userId, A));
    expect(rows).toHaveLength(1);
  });

  it("la app no ve las filas anónimas", async () => {
    await deleteAccountOf(A);
    const rows = await appConn.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${B}, true)`);
      return tx.select({ id: s.llmCalls.id }).from(s.llmCalls).where(isNull(s.llmCalls.userId));
    });
    expect(rows).toHaveLength(0);
  });
});
