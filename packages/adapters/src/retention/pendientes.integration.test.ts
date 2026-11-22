import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PROCESSING_REASON,
  PROCESSING_UNEXPECTED_REASON,
  STALE_PROCESSING_REASON,
  STALE_PROCESSING_UNEXPECTED_REASON,
} from "../inbound/handle";
import { purgeExpired, stalePendingSelectSql } from "./purge";

/** Las provisionales de más de una hora pasan a la cola manual; nada se borra y lo reciente no se toca. */
const USER = "a0000000-0000-4000-8000-0000000000d2";
const NOW = new Date("2026-06-30T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

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
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

const mk = async (emailId: string, ageMinutes: number, error: string, rawRef = "pending:") => {
  await conn.db.insert(s.inboundEmails).values({
    userId: USER,
    emailId,
    fromAddress: "x@example.com",
    rawRef,
    parser: "none",
    error,
    receivedAt: minutesAgo(ageMinutes),
  });
};
const rowOf = async (emailId: string) =>
  (await conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.emailId, emailId)))[0];

describe("barrido de provisionales abandonadas", () => {
  it("mueve a la cola manual las de más de 1 h, no toca las recientes y no borra nada", async () => {
    await mk("em_barr_vieja", 61, PROCESSING_REASON);
    await mk("em_barr_vieja_ne", 120, PROCESSING_UNEXPECTED_REASON);
    await mk("em_barr_reciente", 59, PROCESSING_REASON);
    await mk("em_barr_terminada", 300, "sin parser para este remitente: cola manual", "pg:abc");

    const r = await purgeExpired(conn.db, { now: NOW });

    expect(r.stalePending).toBe(2);
    expect((await rowOf("em_barr_vieja"))?.error).toBe(STALE_PROCESSING_REASON);
    expect((await rowOf("em_barr_vieja_ne"))?.error).toBe(STALE_PROCESSING_UNEXPECTED_REASON);
    expect((await rowOf("em_barr_reciente"))?.error).toBe(PROCESSING_REASON);
    expect((await rowOf("em_barr_terminada"))?.error).toBe(
      "sin parser para este remitente: cola manual",
    );
    const all = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(like(s.inboundEmails.emailId, "em_barr_%"));
    expect(all).toHaveLength(4);

    // Segunda corrida: lo movido no vuelve a contarse
    expect((await purgeExpired(conn.db, { now: NOW })).stalePending).toBe(0);
  });

  it("el barrido usa índice sobre inbound_emails con miles de filas", async () => {
    // Mismo índice parcial que declara schema.ts; se asegura acá por si la migración todavía no corrió
    await conn.db.execute(
      sql`CREATE INDEX IF NOT EXISTS inbound_emails_pending ON inbound_emails (received_at) WHERE raw_ref = 'pending:'`,
    );
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser, error, received_at)
      SELECT ${USER}::uuid, 'x@example.com', 'pg:' || g::text, 'linkedin', NULL,
        ${minutesAgo(600).toISOString()}::timestamptz
      FROM generate_series(1, 6000) g
    `);
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser, error, received_at)
      SELECT ${USER}::uuid, 'x@example.com', 'pending:', 'none', ${PROCESSING_REASON},
        ${minutesAgo(120).toISOString()}::timestamptz
      FROM generate_series(1, 20)
    `);
    await conn.db.execute(sql`ANALYZE inbound_emails`);

    const plan = (await conn.db.execute(
      sql`EXPLAIN ${stalePendingSelectSql(minutesAgo(60), 5_000)}`,
    )) as unknown as Record<string, string>[];
    const text = plan.map((r) => Object.values(r)[0]).join("\n");

    expect(text).not.toMatch(/Seq Scan on inbound_emails/);
  });
});
