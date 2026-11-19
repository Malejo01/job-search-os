import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, processInboundEvent, UNEXPECTED_SENDER_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** Cupos del correo entrante: remitentes esperados y no esperados cuentan por separado. */
const USER = "a0000000-0000-4000-8000-0000000000d1";
const ADDRESS = "u_d1000000@ingest.test";
const PORTAL = "LinkedIn <jobs-noreply@linkedin.com>";
const CUALQUIERA = "Persona <persona@otro.example>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });

const event = (emailId: string, from: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T12:00:00.000Z",
  data: {
    email_id: emailId,
    from,
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Novedades",
    attachments: [],
  },
});

/** Un día de correo de remitentes no esperados, ya guardado. */
async function fillUnexpected(n: number): Promise<void> {
  await conn.db.insert(s.inboundEmails).values(
    Array.from({ length: n }, (_, i) => ({
      userId: USER,
      emailId: `em_relleno_${i}`,
      fromAddress: CUALQUIERA,
      rawRef: "pg:00000000-0000-4000-8000-000000000000",
      parser: "none",
      error: UNEXPECTED_SENDER_REASON,
    })),
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
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Cuotas",
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

describe("cupos separados", () => {
  it("300 emails de remitentes no esperados no dejan sin cupo al correo de un portal", async () => {
    await fillUnexpected(300);

    const otro = event("em_cuota_otro", CUALQUIERA);
    expect(await handleInboundEmail(otro, null, JSON.stringify(otro), deps())).toMatchObject({
      kind: "rate_limited",
    });

    const portal = event("em_cuota_portal", PORTAL);
    expect(await handleInboundEmail(portal, null, JSON.stringify(portal), deps())).toMatchObject({
      kind: "stored",
    });
  });

  it("con el cupo agotado no se pide el cuerpo a Resend", async () => {
    const fetchContent = vi.fn(async () => null);
    const ev = event("em_cuota_sin_cuerpo", CUALQUIERA);

    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());

    expect(out).toMatchObject({ kind: "rate_limited", userId: USER });
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("con cupo, el cuerpo se pide una vez", async () => {
    const fetchContent = vi.fn(async () => null);
    const ev = event("em_cuota_con_cuerpo", PORTAL);

    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());

    expect(out.kind).toBe("stored");
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("los rechazados quedan contados por usuario y hora, sin guardar el email", async () => {
    const rejections = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(eq(s.inboundRejections.userId, USER));
    expect(rejections.reduce((sum, r) => sum + r.rejected, 0)).toBeGreaterThanOrEqual(2);
    const stored = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_cuota_sin_cuerpo"));
    expect(stored).toHaveLength(0);
  });
});

describe("conteo del cupo con volumen", () => {
  it("el conteo por persona y fecha usa el índice, sin Seq Scan sobre inbound_emails", async () => {
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser, error, received_at)
      SELECT ('b0000000-0000-4000-8000-' || lpad((g % 100)::text, 12, '0'))::uuid,
             'x@otro.example', 'pg:0', 'none',
             CASE WHEN g % 2 = 0 THEN ${UNEXPECTED_SENDER_REASON} ELSE NULL END,
             now() - (g % 20 || ' hours')::interval
      FROM generate_series(1, 8000) g
    `);
    await conn.db.execute(sql`ANALYZE inbound_emails`);

    const plan = (await conn.db.execute(sql`
      EXPLAIN
      SELECT count(*) FILTER (WHERE received_at >= now() - interval '1 hour')::int, count(*)::int
      FROM inbound_emails
      WHERE user_id = 'b0000000-0000-4000-8000-000000000007'
        AND received_at >= now() - interval '24 hours'
        AND (error IS NULL OR error NOT IN (${UNEXPECTED_SENDER_REASON}))
    `)) as unknown as Record<string, string>[];
    const text = plan.map((r) => Object.values(r)[0]).join("\n");

    expect(text).not.toMatch(/Seq Scan on inbound_emails/);
    expect(text).toMatch(/inbound_emails_user_received/);
  });
});
