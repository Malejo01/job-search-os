import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { computeUnitCosts } from "@job-search-os/pipeline";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// La consulta vive en la web (tablero de costos); se prueba acá porque apps/web no tiene integración
import { readUnitCostRows } from "../../../../apps/web/lib/unit-cost-rows";

/** Costo por unidad (R21-02) contra Postgres real y datos ficticios. */
const NOW = new Date("2026-12-10T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

type Row = Partial<typeof s.llmCalls.$inferInsert> & { task: string };
async function calls(rows: Row[]): Promise<void> {
  await conn.db
    .insert(s.llmCalls)
    .values(
      rows.map((r) => ({ model: "modelo-ficticio", ok: true, createdAt: hoursAgo(1), ...r })),
    );
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
  conn = createDb(ownerUrl, { max: 4 });
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.llmCalls);
  await conn?.close();
  await container?.stop();
});

describe("filas agregadas del costo por unidad", () => {
  beforeEach(async () => {
    await conn.db.delete(s.llmCalls);
  });

  it("base vacía: sin unidades, sin personas, sin división por cero", async () => {
    const rows = await readUnitCostRows(conn.db, NOW);
    expect(rows).toEqual({ tasks: [], coachChats: 0, personSpendUsd: [] });
    const r = computeUnitCosts(rows);
    expect(r.ok && r.value.offer.costPerUnitUsd).toBeNull();
    expect(r.ok && r.value.person).toEqual({ kind: "sin_datos" });
  });

  it("agrega por tarea, cuenta charlas distintas y arma el gasto anónimo por persona", async () => {
    const a = randomUUID();
    const b = randomUUID();
    const c = randomUUID();
    await calls([
      { task: "evaluate_job", userId: a, costUsd: 0.1 },
      { task: "evaluate_job", userId: a, costUsd: 0.1 },
      { task: "evaluate_job", userId: b, costUsd: 0.2, ok: false },
      { task: "extract_skills", userId: b, costUsd: 0.05 },
      { task: "cv_coach_turn", userId: c, costUsd: 0.3, label: "cv:flow-1" },
      { task: "cv_coach_turn", userId: c, costUsd: 0.3, label: "cv:flow-1" },
      { task: "cv_write", userId: c, costUsd: 0.1, label: "cv:flow-2" },
      { task: "cv_review", userId: c, costUsd: 0.09, label: "cv:flow-2" },
      { task: "interview_questions", userId: a, costUsd: 0.01 },
    ]);
    const rows = await readUnitCostRows(conn.db, NOW);
    const byTask = Object.fromEntries(rows.tasks.map((t) => [t.task, t]));
    expect(byTask.evaluate_job).toMatchObject({ calls: 3, okCalls: 2 });
    expect(byTask.evaluate_job?.spendUsd).toBeCloseTo(0.4, 4);
    expect(rows.coachChats).toBe(2);
    // a = 0,21; b = 0,25; c = 0,79: solo importes, sin ids
    expect(rows.personSpendUsd.sort((x, y) => x - y).map((n) => Number(n.toFixed(2)))).toEqual([
      0.21, 0.25, 0.79,
    ]);
    const r = computeUnitCosts(rows);
    expect(r.ok && r.value.offer.units).toBe(2);
    expect(r.ok && r.value.person.kind).toBe("ok");
  });

  it("deja afuera evals, reservas, filas viejas, costos inválidos y cuentas de prueba", async () => {
    const real = randomUUID();
    const testUser = randomUUID();
    await conn.db
      .insert(s.users)
      .values({ id: testUser, email: "prueba@example.test", isTest: true });
    await calls([
      { task: "evaluate_job", userId: real, costUsd: 0.1 },
      { task: "evaluate_job", userId: real, costUsd: null },
      { task: "eval:v9", userId: real, costUsd: 5, label: "corrida" },
      { task: "llm_reserve", userId: real, costUsd: 3 },
      { task: "evaluate_job", userId: real, costUsd: 7, createdAt: hoursAgo(24 * 31) },
      { task: "evaluate_job", userId: testUser, costUsd: 4 },
      // sin dueño (cuenta borrada): cuenta en el gasto por tarea, no como persona
      { task: "evaluate_job", userId: null, costUsd: 0.2 },
    ]);
    const rows = await readUnitCostRows(conn.db, NOW);
    expect(rows.tasks.map((t) => t.task)).toEqual(["evaluate_job"]);
    expect(rows.tasks[0]?.calls).toBe(4);
    // cost_usd es real (float4): se compara con tolerancia
    expect(rows.tasks[0]?.spendUsd).toBeCloseTo(4.3, 4);
    expect(rows.personSpendUsd).toHaveLength(1);
    expect(rows.personSpendUsd[0]).toBeCloseTo(0.1, 4);
  });
});
