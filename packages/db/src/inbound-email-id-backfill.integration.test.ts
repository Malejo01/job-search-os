import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./migrate";

/**
 * JS-115: la migración de datos 0053 rescata el email_id de las filas viejas desde el crudo. Se corre su SQL
 * sobre filas armadas como las dejaba el webhook anterior (sin columna). Datos inventados.
 */
const SQL_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "0053_inbound_email_id_backfill.sql",
);

let container: StartedPostgreSqlContainer | null = null;
let owner: Sql;

/** Una fila como la guardaba el webhook anterior: crudo con el email_id adentro y sin columna. */
async function oldRow(emailId: string | null, receivedAt: string, body?: string): Promise<string> {
  const [blob] = await owner<{ id: string }[]>`
    insert into raw_blobs (kind, content_type, body, bytes)
    values ('inbound_email', 'application/json',
            ${body ?? JSON.stringify({ event: { data: { email_id: emailId } } })}, 10)
    returning id`;
  const [row] = await owner<{ id: string }[]>`
    insert into inbound_emails (from_address, raw_ref, received_at)
    values ('x@example.com', ${"pg:" + blob!.id}, ${receivedAt}::timestamptz)
    returning id`;
  return row!.id;
}

const emailIdOf = async (id: string) =>
  (
    await owner<{ email_id: string | null }[]>`select email_id from inbound_emails where id = ${id}`
  )[0]!.email_id;

beforeAll(async () => {
  let ownerUrl: string;
  if (process.env.DATABASE_URL) {
    ownerUrl = process.env.DATABASE_URL;
  } else {
    const pg = new PostgreSqlContainer("pgvector/pgvector:pg16").withDatabase("jobsearch");
    container = await pg.withUsername("postgres").withPassword("postgres").start();
    ownerUrl = container.getConnectionUri();
  }
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = postgres(ownerUrl, { max: 1, prepare: false });
}, 180_000);

afterAll(async () => {
  await owner?.end();
  await container?.stop();
});

describe("backfill de inbound_emails.email_id (JS-115)", () => {
  it("rescata el email_id del crudo, deja en null el repetido más nuevo y no pisa nada", async () => {
    const first = await oldRow("em_bf_1", "2026-10-01T10:00:00Z");
    const repeated = await oldRow("em_bf_1", "2026-10-01T10:05:00Z");
    const other = await oldRow("em_bf_2", "2026-10-02T10:00:00Z");
    // Sin email_id en el crudo, o con un crudo que no es JSON: no tira la migración
    const without = await oldRow(null, "2026-10-03T10:00:00Z", '{"event":{"data":{}}}');
    const notJson = await oldRow(null, "2026-10-03T11:00:00Z", "no es json");
    // Una fila que el webhook nuevo ya guardó con su columna
    const taken = await oldRow("em_bf_3", "2026-10-04T10:00:00Z");
    await owner`update inbound_emails set email_id = 'em_bf_3' where id = ${taken}`;
    const dupOfTaken = await oldRow("em_bf_3", "2026-10-04T09:00:00Z");

    await owner.unsafe(readFileSync(SQL_FILE, "utf8"));

    expect(await emailIdOf(first)).toBe("em_bf_1");
    expect(await emailIdOf(repeated)).toBeNull();
    expect(await emailIdOf(other)).toBe("em_bf_2");
    expect(await emailIdOf(without)).toBeNull();
    expect(await emailIdOf(notJson)).toBeNull();
    expect(await emailIdOf(taken)).toBe("em_bf_3");
    // Aunque sea más vieja, el valor ya estaba tomado: no choca con el índice único
    expect(await emailIdOf(dupOfTaken)).toBeNull();
  });

  it("es idempotente: correrla de nuevo no cambia nada ni falla", async () => {
    const before = await owner`select id, email_id from inbound_emails order by id`;
    await owner.unsafe(readFileSync(SQL_FILE, "utf8"));
    expect(await owner`select id, email_id from inbound_emails order by id`).toEqual(before);
  });
});
