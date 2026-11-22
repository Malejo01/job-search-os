import { readFileSync } from "node:fs";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * El SQL de `docs/beta/pasos-manuales-r17.md` (sección del simulador de entrevistas) que se corre a mano en
 * producción: se extrae del documento y se prueba contra una base real, igual que lo hace `run-sql-file.ts`: el ensayo
 * (con el `COMMIT;` final cambiado por `ROLLBACK;`) no deja nada, la aplicación deja las dos filas exactamente
 * como el seed, y una segunda aplicación la frena la guarda.
 */
type Row = Record<string, string | number | null>;
const seed = JSON.parse(
  readFileSync(new URL("../seeds/model_routing.json", import.meta.url), "utf8"),
) as Row[];
const doc = readFileSync(
  new URL("../../../docs/beta/pasos-manuales-r17.md", import.meta.url),
  "utf8",
);

function extractSql(): string {
  const section = doc.slice(doc.indexOf("## R17-08"));
  const match = /```sql\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error("no se encontró el bloque sql de R17-08 en pasos-manuales-r17.md");
  return match[1]!.trim();
}

const TASKS = ["interview_questions", "interview_feedback"];

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

async function rows() {
  return owner<
    Row[]
  >`select task, provider, model, fallback_model, temperature, max_tokens, thinking_level,
      input_usd_per_mtok, output_usd_per_mtok, fallback_input_usd_per_mtok, fallback_output_usd_per_mtok
    from model_routing where task in ${owner(TASKS)} order by task`;
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
  owner = postgres(ownerUrl, { max: 1, prepare: false });
  await owner`delete from model_routing where task in ${owner(TASKS)}`;
}, 180_000);

afterAll(async () => {
  await owner?.unsafe(
    `delete from model_routing where task in ('interview_questions', 'interview_feedback')`,
  );
  await owner?.end();
  await container?.stop();
});

describe("SQL de model_routing del simulador (pasos manuales)", () => {
  const sqlText = extractSql();

  it("empieza en BEGIN; y termina exactamente en COMMIT;, como exige run-sql-file", () => {
    expect(sqlText.replace(/^(--.*\n)+/, "").startsWith("BEGIN;")).toBe(true);
    expect(sqlText.endsWith("COMMIT;")).toBe(true);
  });

  it("el ensayo corre entero y no deja nada", async () => {
    await owner.unsafe(sqlText.replace(/COMMIT;$/, "ROLLBACK;"));
    expect(await rows()).toHaveLength(0);
  });

  it("aplicado deja las dos filas iguales a las del seed", async () => {
    await owner.unsafe(sqlText);
    const inDb = await rows();
    expect(inDb).toHaveLength(2);
    for (const row of inDb) {
      const expected = seed.find((r) => r.task === row.task);
      expect(expected, String(row.task)).toBeDefined();
      expect(row).toEqual(expected);
    }
  });

  it("una segunda aplicación la frena la guarda y no cambia nada", async () => {
    await expect(owner.unsafe(sqlText)).rejects.toThrow(/ya existe una fila de esas tareas/);
    await owner.unsafe("ROLLBACK");
    expect(await rows()).toHaveLength(2);
  });
});
