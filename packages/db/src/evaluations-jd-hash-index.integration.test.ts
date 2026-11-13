import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * R8-4 · El índice funcional de `evaluations` sirve a la consulta de reutilización de R7-2
 * (`findReusableEvaluation`, packages/adapters/src/worker/evaluate-job.ts): user_id + el hash que leyó la evaluación.
 * Sin datos: con `enable_seqscan = off` el planificador usa el índice solo si la expresión de la consulta coincide con la
 * del índice. Si alguien cambia la expresión de un lado y no del otro, este test falla.
 */
const USER = "11111111-1111-1111-1111-111111111111";
const JOB = "33333333-3333-3333-3333-333333333333";

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

beforeAll(async () => {
  let url: string;
  if (process.env.DATABASE_URL) {
    url = process.env.DATABASE_URL;
  } else {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
      .withDatabase("jobsearch")
      .withUsername("postgres")
      .withPassword("postgres")
      .start();
    url = container.getConnectionUri();
  }
  await applyMigrations(url, { log: () => {} });
  owner = postgres(url, { max: 1, prepare: false });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("índice evaluations_user_inputs_jd_hash (R8-4)", () => {
  it("existe, sobre user_id y la expresión del jd_hash", async () => {
    const rows = await owner<{ indexdef: string }[]>`
      select indexdef from pg_indexes where tablename = 'evaluations' and indexname = 'evaluations_user_inputs_jd_hash'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("user_id");
    expect(rows[0]!.indexdef).toContain("'jd_hash'");
  });

  it("la consulta de reutilización usa el índice, no un recorrido de toda la tabla", async () => {
    const plan = await owner.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      const rows = await tx.unsafe(
        `EXPLAIN select id from evaluations
         where user_id = '${USER}'
           and decision -> 'inputs' ->> 'jd_hash' = 'hash-ficticio'
           and job_id <> '${JOB}'
           and prompt_version = 'evaluate_job@v1'
           and criteria_version = 1
         order by created_at desc limit 1`,
      );
      return (rows as unknown as { "QUERY PLAN": string }[]).map((r) => r["QUERY PLAN"]).join("\n");
    });
    expect(plan).toContain("evaluations_user_inputs_jd_hash");
  });
});
