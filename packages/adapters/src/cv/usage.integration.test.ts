import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzleCvUsage, EXTRACT_CV_TASK } from "./extract";

/**
 * Cupo de lecturas de CV (decisión de Mauro, 21/10): una lectura cortada por tiempo o cancelada no
 * consume cupo; el resto de las filas de `llm_calls` de la tarea sí. Datos inventados.
 */
const USER = "00000000-0000-4000-8000-0000000c0123";
const NOW = new Date("2026-10-21T12:00:00Z");
const DAYS_AGO = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

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
  if (isRemoteDatabase(ownerUrl)) throw new Error("usage.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.userId, USER));
  const row = (ok: boolean, error: string | null, createdAt: Date, task = EXTRACT_CV_TASK) => ({
    userId: USER,
    task,
    model: "modelo-de-prueba",
    ok,
    error,
    createdAt,
  });
  await conn.db.insert(s.llmCalls).values([
    row(true, null, DAYS_AGO(1)), // cuenta
    row(false, "timeout", DAYS_AGO(2)), // no cuenta
    row(false, "aborted", DAYS_AGO(3)), // no cuenta
    row(false, "provider_unavailable", DAYS_AGO(4)), // no cuenta: no se llegó a llamar
    row(true, null, DAYS_AGO(40)), // fuera de la ventana
    row(true, null, DAYS_AGO(1), "evaluate_job"), // otra tarea
  ]);
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls).where(eq(s.llmCalls.userId, USER));
  await conn?.close();
  await container?.stop();
});

describe("drizzleCvUsage", () => {
  it("no cuenta las lecturas cortadas por tiempo, canceladas ni sin proveedor", async () => {
    const used = await drizzleCvUsage(conn.db).countSince(USER, DAYS_AGO(30));
    expect(used).toBe(1);
  });
});
