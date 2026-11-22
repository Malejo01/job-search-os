import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, PENDING_RECLAIM_MS, PROCESSING_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** Una fila provisional abandonada no pierde el email: el reintento la retoma una sola vez. */
const USER = "a0000000-0000-4000-8000-0000000000d1";
const ADDRESS = "u_d1000000@ingest.test";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-11T20:00:00.000Z",
  data: {
    email_id: emailId,
    from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Empresa A viewed your application",
    attachments: [],
  },
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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Pendientes",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: ADDRESS,
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("fila provisional abandonada", () => {
  const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });
  const rowsOf = (emailId: string) =>
    conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.emailId, emailId));
  const seedPending = (emailId: string, ageMinutes: number) =>
    conn.db.insert(s.inboundEmails).values({
      userId: USER,
      emailId,
      fromAddress: "x@example.com",
      rawRef: "pending:",
      parser: "none",
      error: PROCESSING_REASON,
      receivedAt: minutesAgo(ageMinutes),
    });

  it("la función murió después de la fila: el reintento a los 11 minutos procesa y guarda el email", async () => {
    const ev = event("em_pend_caida");
    await seedPending("em_pend_caida", 11);

    const retry = await handleInboundEmail(ev, null, JSON.stringify(ev), deps());

    expect(retry.kind).toBe("stored");
    const rows = await rowsOf("em_pend_caida");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rawRef).not.toBe("pending:");
    expect(rows[0]?.error).not.toBe(PROCESSING_REASON);
  });

  it("dos reintentos a la vez sobre la misma fila vieja: procesa uno solo, el otro es duplicado", async () => {
    const ev = event("em_pend_carrera");
    await seedPending("em_pend_carrera", 11);

    const results = await Promise.all([
      handleInboundEmail(ev, null, JSON.stringify(ev), deps()),
      handleInboundEmail(ev, null, JSON.stringify(ev), deps()),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual(["duplicate", "stored"]);
    expect(await rowsOf("em_pend_carrera")).toHaveLength(1);
  });

  it("una fila provisional de 5 minutos no se toma: el reintento es duplicado", async () => {
    const ev = event("em_pend_reciente");
    await seedPending("em_pend_reciente", 5);

    const retry = await handleInboundEmail(ev, null, JSON.stringify(ev), deps());

    expect(retry.kind).toBe("duplicate");
    const [row] = await rowsOf("em_pend_reciente");
    expect(row?.rawRef).toBe("pending:");
  });

  it("retomar no suma otro intento al cupo: sigue habiendo una sola fila por email_id", async () => {
    const before = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, USER));
    const ev = event("em_pend_cupo");
    await seedPending("em_pend_cupo", 11);

    // Con el cupo diario justo en lo que ya hay, el intento ya contado igual se retoma
    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), {
      ...deps(),
      dailyLimit: before.length + 1,
    });

    expect(out.kind).toBe("stored");
    const after = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, USER));
    expect(after).toHaveLength(before.length + 1);
  });

  it("el plazo para retomar es de 10 minutos", () => {
    expect(PENDING_RECLAIM_MS).toBe(600_000);
  });
});
