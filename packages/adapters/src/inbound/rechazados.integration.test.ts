import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import {
  handleInboundEmail,
  PENDING_RAW_REF,
  PENDING_RECLAIM_MS,
  PROCESSING_REASON,
  UNEXPECTED_SENDER_REASON,
} from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** El contador de rechazados no suma el reintento que retoma una fila provisional. */
const USER = "a0000000-0000-4000-8000-0000000000f4";
const ADDRESS = "u_000000f4@ingest.test";
const PORTAL = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>";
const garbage = {
  html: "<p>contenido sin la estructura de una alerta</p>",
  text: null,
  headers: null,
};

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({
  db: conn.db,
  storage: pgBlobStorage(conn.db),
  logger,
  authservId: "mx.example",
  dmarcMode: "log" as const,
  hourlyLimit: 1,
});

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-22T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: PORTAL,
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "AI Engineer: 3 nuevas ofertas",
    attachments: [],
  },
});

const rejectedCount = async () =>
  Number(
    (
      (await conn.db.execute(
        sql`SELECT coalesce(sum(rejected), 0)::int AS n FROM inbound_rejections WHERE user_id = ${USER}::uuid`,
      )) as unknown as { n: number }[]
    )[0]?.n,
  );

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Rechazados",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: ADDRESS,
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
  // Cupo de no esperados lleno: una fila de remitente no esperado en la última hora
  await conn.db.insert(s.inboundEmails).values({
    userId: USER,
    emailId: "em_rech_lleno",
    fromAddress: "x@example.com",
    rawRef: "none:",
    parser: "none",
    error: UNEXPECTED_SENDER_REASON,
    receivedAt: new Date(),
  });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("contador de rechazados", () => {
  it("el rechazo definitivo de una primera entrega suma uno", async () => {
    const before = await rejectedCount();
    const ev = event("em_rech_primera");

    const out = await handleInboundEmail(ev, garbage, JSON.stringify(ev), deps());

    expect(out.kind).toBe("rate_limited");
    expect(await rejectedCount()).toBe(before + 1);
  });

  it("el reintento que retoma una fila provisional abandonada no suma otra vez", async () => {
    await conn.db.insert(s.inboundEmails).values({
      userId: USER,
      emailId: "em_rech_retoma",
      fromAddress: PORTAL,
      rawRef: PENDING_RAW_REF,
      parser: "none",
      error: PROCESSING_REASON,
      receivedAt: new Date(Date.now() - PENDING_RECLAIM_MS - 60_000),
    });
    const before = await rejectedCount();
    const ev = event("em_rech_retoma");

    const out = await handleInboundEmail(ev, garbage, JSON.stringify(ev), deps());

    expect(out.kind).toBe("rate_limited");
    expect(await rejectedCount()).toBe(before);
    const rows = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_rech_retoma"));
    expect(rows).toHaveLength(0);
  });
});
