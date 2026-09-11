import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, MANUAL_QUEUE_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** JS-020: email entrante → crudo en storage + fila en inbound_emails + despacho (cola manual sin parser). */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const event = (emailId: string, to = "u_a0000000@ingest.test"): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-11T20:00:00.000Z",
  data: {
    email_id: emailId,
    from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    to: [to],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "AI Engineer: 3 nuevas ofertas",
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
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a0000000@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("handleInboundEmail", () => {
  it("guarda el crudo, la fila y manda a cola manual cuando no hay parser; el reintento es idempotente", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const raw = JSON.stringify(event("em_1"));
    const out = await handleInboundEmail(
      event("em_1"),
      { html: "<p>hola</p>", text: "hola", headers: null },
      raw,
      deps,
    );
    expect(out).toMatchObject({
      kind: "stored",
      userId: USER,
      parser: null,
      jobsExtracted: 0,
      error: MANUAL_QUEUE_REASON,
    });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({
      fromAddress: expect.stringContaining("linkedin.com"),
      parser: "none",
    });
    const blob = await deps.storage.get(row!.rawRef);
    expect(blob?.contentType).toBe("application/json");
    expect(JSON.parse(blob!.body)).toMatchObject({
      event: { data: { email_id: "em_1" } },
      content: { text: "hola" },
    });

    const again = await handleInboundEmail(event("em_1"), null, raw, deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
  });

  it("ignora destinatarios que no son de ningún usuario y aplica rate limit por hora", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const unknown = await handleInboundEmail(event("em_2", "nadie@ingest.test"), null, "{}", deps);
    expect(unknown).toMatchObject({ kind: "unknown_recipient" });
    const limited = await handleInboundEmail(event("em_3"), null, JSON.stringify(event("em_3")), {
      ...deps,
      hourlyLimit: 1,
    });
    expect(limited).toMatchObject({ kind: "rate_limited", userId: USER });
  });
});
