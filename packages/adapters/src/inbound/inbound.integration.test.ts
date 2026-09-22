import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

const SIN_PARSER = "Equipo de Talento <jobs@example.com>";

const event = (
  emailId: string,
  to = "u_a0000000@ingest.test",
  from = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-11T20:00:00.000Z",
  data: {
    email_id: emailId,
    from,
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
    const raw = JSON.stringify(event("em_1", undefined, SIN_PARSER));
    const out = await handleInboundEmail(
      event("em_1", undefined, SIN_PARSER),
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
      fromAddress: expect.stringContaining("example.com"),
      parser: "none",
    });
    const blob = await deps.storage.get(row!.rawRef);
    expect(blob?.contentType).toBe("application/json");
    expect(JSON.parse(blob!.body)).toMatchObject({
      event: { data: { email_id: "em_1" } },
      content: { text: "hola" },
    });

    const again = await handleInboundEmail(event("em_1", undefined, SIN_PARSER), null, raw, deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
  });

  it("con parser pero estructura desconocida también va a cola manual, sin inventar ofertas (JS-021)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    // remitente de LinkedIn, pero el HTML no es una alerta con tarjetas de aviso
    const out = await handleInboundEmail(
      event("em_4"),
      { html: "<p>Tenés una nueva recomendación</p>", text: null, headers: null },
      JSON.stringify(event("em_4")),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", parser: "linkedin", jobsExtracted: 0 });
    if (out.kind !== "stored") return;
    expect(out.error).toMatch(/cola manual/i);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({ parser: "linkedin", jobsExtracted: 0 });
    expect(row!.error).toMatch(/cola manual/i);
  });

  it("notificación social de LinkedIn: se guarda como no relevante, descartada y con su crudo (JS-050)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_social_1", undefined, "LinkedIn <messages-noreply@linkedin.com>");
    const out = await handleInboundEmail(
      ev,
      { html: "<p>Una persona de tu red es popular</p>", text: null, headers: null },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({
      kind: "stored",
      parser: "linkedin_social",
      jobsExtracted: 0,
      error: null,
    });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({ parser: "linkedin_social", error: null });
    expect(row!.dismissedAt).not.toBeNull();
    expect(await deps.storage.get(row!.rawRef)).not.toBeNull();
  });

  it("si una notificación social trae tarjetas de aviso, queda pendiente para revisar la regla (JS-050)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const html = readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8");
    const ev = event("em_social_2", undefined, "LinkedIn <invitations@linkedin.com>");
    const out = await handleInboundEmail(
      ev,
      { html, text: null, headers: null },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", parser: "linkedin_social", jobsExtracted: 0 });
    if (out.kind !== "stored") return;
    expect(out.error).toMatch(/revisar la regla/);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    // No se descarta ni se ingesta: la persona lo ve en Pendientes y decide
    expect(row!.dismissedAt).toBeNull();
    const jobs = await conn.db.select({ id: s.jobs.id }).from(s.jobs);
    expect(jobs).toHaveLength(0);
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
    const again = await handleInboundEmail(event("em_5"), null, JSON.stringify(event("em_5")), {
      ...deps,
      hourlyLimit: 1,
    });
    expect(again).toMatchObject({ kind: "rate_limited", userId: USER });
    // JS-038: los rechazados no se guardan, pero quedan contados por usuario y hora
    const rejections = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(eq(s.inboundRejections.userId, USER));
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.rejected).toBe(2);
  });
});
