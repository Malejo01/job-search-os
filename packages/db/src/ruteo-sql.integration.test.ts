import { readFileSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";
import { asRehearsal } from "./run-sql-file";

/**
 * El SQL de producción del ruteo (`packages/db/sql/ruteo-s4.sql`) probado contra un Postgres propio:
 * parte del estado de hoy, el ensayo no deja nada, la corrida real deja las filas igual que el seed y
 * la guarda frena si una fila no está como se esperaba. Siempre un contenedor propio: este test escribe,
 * así que no usa DATABASE_URL.
 */
type Row = {
  task: string;
  provider: string;
  model: string;
  fallback_model: string | null;
  temperature: number;
  max_tokens: number;
  thinking_level: string | null;
  input_usd_per_mtok: number;
  output_usd_per_mtok: number;
  fallback_input_usd_per_mtok: number | null;
  fallback_output_usd_per_mtok: number | null;
};

const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];
const sqlText = readFileSync(new URL("../sql/ruteo-s4.sql", import.meta.url), "utf8");
const TASKS = [
  "evaluate_job",
  "extract_skills",
  "parse_email_fallback",
  "cv_interview",
  "extract_cv_profile",
  "cv_write",
  "cv_review",
  "cv_coach_turn",
  "extract_job_from_image",
];

let container: StartedPostgreSqlContainer;
let owner: Sql;

/**
 * Estado de hoy: Gemini principal salvo `evaluate_job`, que ya es Sonnet (en producción con thinking y
 * max_tokens propios, que el SQL alinea al seed: acá `low` y 8192).
 */
async function loadCurrentState(): Promise<void> {
  await owner`delete from model_routing`;
  for (const t of TASKS) {
    const s = seed.find((r) => r.task === t)!;
    const legacy = t === "evaluate_job";
    const lite = t === "parse_email_fallback";
    await owner`
      insert into model_routing (task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
        input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok)
      values (${t}, ${legacy ? "anthropic" : "google"},
        ${legacy ? "claude-sonnet-5-5" : lite ? "gemini-3.1-flash-lite" : "gemini-3.5-flash"},
        ${legacy ? "claude-haiku-4-5" : null}, ${s.temperature}, ${legacy ? 8192 : s.max_tokens},
        ${legacy ? "low" : "minimal"}, ${legacy ? 2 : 1.5}, ${legacy ? 10 : 9}, ${legacy ? 1 : null}, ${legacy ? 5 : null})`;
  }
}

const snapshot = () => owner`select * from model_routing order by task`;

/** Una guarda que frena deja la transacción abierta y abortada: run-sql-file cierra la conexión; acá, ROLLBACK. */
async function expectBlocked(text: string, message: RegExp): Promise<void> {
  await expect(owner.unsafe(text)).rejects.toThrow(message);
  await owner.unsafe("ROLLBACK");
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("pgvector/pgvector:pg16")
    .withDatabase("jobsearch")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();
  const url = container.getConnectionUri();
  await applyMigrations(url, { log: () => {} });
  owner = postgres(url, { max: 1, prepare: false });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

beforeEach(loadCurrentState);

describe("ruteo-s4.sql", () => {
  it("el ensayo corre entero y no deja nada", async () => {
    const before = await snapshot();
    await owner.unsafe(asRehearsal(sqlText));
    expect(await snapshot()).toEqual(before);
  });

  it("la corrida real deja las tareas como el seed y no toca temperature ni max_tokens", async () => {
    await owner.unsafe(sqlText);
    const rows = await owner<Row[]>`select * from model_routing where task = any(${TASKS})`;
    expect(rows).toHaveLength(9);
    for (const r of rows) {
      const expected = seed.find((s) => s.task === r.task)!;
      // evaluate_job también queda con el max_tokens (2048) y el thinking_level (null) del seed: producción,
      // evals y la reserva de gasto miden lo mismo
      expect(r, r.task).toMatchObject(expected);
    }
  });

  it("evaluate_job parte con thinking y max_tokens propios y termina alineado al seed", async () => {
    const [before] =
      await owner`select max_tokens, thinking_level from model_routing where task = 'evaluate_job'`;
    expect(before).toMatchObject({ max_tokens: 8192, thinking_level: "low" });
    await owner.unsafe(sqlText);
    const [after] =
      await owner`select max_tokens, thinking_level from model_routing where task = 'evaluate_job'`;
    expect(after).toMatchObject({ max_tokens: 2048, thinking_level: null });
  });

  it.each([
    ["max_tokens", "new.max_tokens := 8192;", /temperature o max_tokens/],
    ["thinking_level", "new.thinking_level := 'low';", /evaluate_job/],
  ])(
    "la guarda final cubre evaluate_job: frena si su %s no queda como el seed",
    async (_campo, deshacer, mensaje) => {
      // Un disparador que deshace el UPDATE simula una fila que no queda alineada
      await owner.unsafe(`
        create or replace function undo_eval_test() returns trigger language plpgsql as $$
        begin ${deshacer} return new; end $$;
      `);
      await owner.unsafe(
        `create trigger undo_eval before update on model_routing for each row when (new.task = 'evaluate_job') execute function undo_eval_test()`,
      );
      try {
        await expectBlocked(sqlText, mensaje);
      } finally {
        await owner.unsafe("drop trigger if exists undo_eval on model_routing");
        await owner.unsafe("drop function if exists undo_eval_test()");
      }
    },
  );

  it("la guarda previa frena sin tocar nada si una fila no está como se esperaba", async () => {
    await owner`update model_routing set model = 'otro-modelo' where task = 'cv_write'`;
    const before = await snapshot();
    await expectBlocked(sqlText, /cv_write/);
    expect(await snapshot()).toEqual(before);
  });

  it("la guarda previa frena si falta una fila", async () => {
    await owner`delete from model_routing where task = 'cv_review'`;
    await expectBlocked(sqlText, /cv_review/);
  });

  it("la guarda final frena si el max_tokens de una fila difiere del seed", async () => {
    await owner`update model_routing set max_tokens = 999 where task = 'extract_skills'`;
    await expectBlocked(sqlText, /temperature o max_tokens/);
    const [r] = await owner`select model from model_routing where task = 'extract_skills'`;
    expect(r!.model).toBe("gemini-3.5-flash");
  });
});
