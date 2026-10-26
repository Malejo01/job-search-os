import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluateStatus, readStatusSnapshot } from "./status";

/**
 * V6 · `llm_primary_failed_24h`: filas como las que genera `llm/client.ts` (una por llamada exitosa;
 * dos por llamada que cae al respaldo: el primario con error y el respaldo).
 */
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const NOW = new Date();
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const PRIMARY = "modelo-primario-a";
const FALLBACK = "modelo-respaldo-a";

const setRoute = (model: string, fallbackModel: string | null, updatedAt: Date) =>
  conn.db
    .insert(s.modelRouting)
    .values({ task: "evaluate_job", provider: "google", model, fallbackModel, updatedAt })
    .onConflictDoUpdate({
      target: s.modelRouting.task,
      set: { model, fallbackModel, updatedAt },
    });

const call = (model: string, ok: boolean, createdAt: Date) => ({
  task: "evaluate_job",
  model,
  ok,
  createdAt,
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
  conn = createDb(ownerUrl, { max: 4 });
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.llmCalls).where(eq(s.llmCalls.task, "evaluate_job"));
  await setRoute(PRIMARY, FALLBACK, ago(48));
});

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

const primaryCheck = async () => {
  const snap = await readStatusSnapshot(conn.db, NOW);
  return evaluateStatus(snap, NOW).checks.find((c) => c.name === "llm_primary_failed_24h");
};

describe("llm_primary_failed_24h sobre filas reales de llm_calls", () => {
  it("caída total del primario: 12 llamadas, 24 filas, da 100 % y falla", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => [
      call(PRIMARY, false, ago(1 + i / 10)),
      call(FALLBACK, true, ago(1 + i / 10)),
    ]).flat();
    await conn.db.insert(s.llmCalls).values(rows);
    expect(await primaryCheck()).toMatchObject({ ok: false, value: 100 });
  });

  it("primario sano con algunos fallos aislados: pasa", async () => {
    const rows = [
      ...Array.from({ length: 8 }, (_, i) => call(PRIMARY, true, ago(1 + i / 10))),
      ...Array.from({ length: 4 }, (_, i) => [
        call(PRIMARY, false, ago(3 + i / 10)),
        call(FALLBACK, true, ago(3 + i / 10)),
      ]).flat(),
    ];
    await conn.db.insert(s.llmCalls).values(rows);
    expect(await primaryCheck()).toMatchObject({ ok: true, value: 33.3 });
  });

  it("ignora filas anteriores al último cambio de ruteo", async () => {
    await setRoute(PRIMARY, FALLBACK, ago(2));
    const old = Array.from({ length: 12 }, (_, i) => call(PRIMARY, false, ago(10 + i / 10)));
    await conn.db.insert(s.llmCalls).values(old);
    expect(await primaryCheck()).toMatchObject({ ok: true, value: null });
  });

  it("ruta con primario igual al respaldo: el check no aplica", async () => {
    await setRoute(PRIMARY, PRIMARY, ago(48));
    await conn.db
      .insert(s.llmCalls)
      .values(Array.from({ length: 12 }, (_, i) => call(PRIMARY, false, ago(1 + i / 10))));
    expect(await primaryCheck()).toMatchObject({ ok: true, value: null });
  });
});
