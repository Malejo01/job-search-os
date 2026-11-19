import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FAILED_CALL_ESTIMATE_USD, spendBreakdown, spendSince } from "./spend";

/** Qué fallas sin costo cuentan como gasto estimado (datos ficticios, Postgres real). */
const NOW = new Date("2026-11-12T12:00:00.000Z");
const USER = "00000000-0000-4000-8000-0000000000c1";
const since = new Date(NOW.getTime() - 24 * 3_600_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const failed = (error: string | null, n = 1) =>
  Array.from({ length: n }, () => ({
    userId: USER,
    task: "evaluate_job",
    model: "modelo-ficticio",
    ok: false,
    costUsd: null,
    error,
    createdAt: new Date(NOW.getTime() - 3_600_000),
  }));

async function usdFor(error: string | null, n = 1): Promise<number> {
  await conn.db.delete(s.llmCalls);
  await conn.db.insert(s.llmCalls).values(failed(error, n));
  const usd = (await spendSince(conn.db, since)).usd;
  const breakdown = (await spendBreakdown(conn.db, since)).reduce((a, r) => a + r.usd, 0);
  expect(breakdown).toBeCloseTo(usd, 9);
  return usd;
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
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("fallas sin costo y gasto estimado", () => {
  it("50 fallas 401 dejan el gasto en 0", async () => {
    expect(await usdFor("api_call:401", 50)).toBe(0);
  });

  it("los 4xx, incluido 429, cuentan 0", async () => {
    for (const code of ["api_call:400", "api_call:402", "api_call:403", "api_call:404"]) {
      expect(await usdFor(code)).toBe(0);
    }
    expect(await usdFor("api_call:429", 10)).toBe(0);
  });

  it("timeout, 5xx y errores sin código cuentan el estimado", async () => {
    for (const code of [
      "timeout",
      "api_call:500",
      "api_call:503",
      "api_call:529",
      "api_call",
      "unknown",
    ]) {
      expect(await usdFor(code)).toBeCloseTo(FAILED_CALL_ESTIMATE_USD, 9);
    }
    expect(await usdFor(null)).toBeCloseTo(FAILED_CALL_ESTIMATE_USD, 9);
  });

  it("un intento que nunca llegó al proveedor no cuenta", async () => {
    expect(await usdFor("provider_unavailable")).toBe(0);
  });
});
