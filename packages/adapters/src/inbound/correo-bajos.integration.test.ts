import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import { loadInboundContent, type ResendReceivedEvent } from "./resend";

/** Un 404 de Resend no pierde el email, y una configuración de seguridad a medias queda en el log. */
const USER = "a0000000-0000-4000-8000-0000000000a1";
const ADDRESS = "u_a1000000@ingest.test";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    to: [ADDRESS],
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
      displayName: "Bajos",
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

describe("404 de Resend al pedir el cuerpo", () => {
  it("el email va a la cola manual con remitente, asunto y fecha, sin perderse", async () => {
    const fetch404 = vi.fn(async () => new Response("no existe", { status: 404 }));
    const content = await loadInboundContent(
      "em_404",
      "clave-de-prueba",
      { warn: () => undefined },
      fetch404 as unknown as typeof fetch,
    );
    expect(content).toBeNull();

    const ev = event("em_404");
    const out = await handleInboundEmail(ev, content, JSON.stringify(ev), deps());

    expect(out).toMatchObject({ kind: "stored" });
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_404"));
    expect(row?.fromAddress).toContain("jobalerts-noreply@linkedin.com");
    expect(row?.subject).toBe("AI Engineer: 3 nuevas ofertas");
    expect(row?.receivedAt).toBeInstanceOf(Date);
    expect(row?.error).toMatch(/cola manual/);
    // Sigue pendiente para que la persona lo vea
    expect(row?.seenAt).toBeNull();
    expect(row?.dismissedAt).toBeNull();
  });
});

describe("enforce sin servidor de autenticación", () => {
  it("deja un error en el log con el usuario, sin copiar ningún valor", async () => {
    const errors: { ctx: Record<string, unknown>; msg: string }[] = [];
    const spyWith = (bindings: Record<string, unknown>): unknown => ({
      child: (more: Record<string, unknown>) => spyWith({ ...bindings, ...more }),
      info: () => undefined,
      warn: () => undefined,
      debug: () => undefined,
      error: (ctx: Record<string, unknown>, msg: string) =>
        errors.push({ ctx: { ...bindings, ...ctx }, msg }),
    });
    const spy = spyWith({});
    const ev = event("em_enforce_sin_id");

    await handleInboundEmail(ev, null, JSON.stringify(ev), {
      ...deps(),
      logger: spy as unknown as typeof logger,
      dmarcMode: "enforce",
      authservId: undefined,
    });

    const found = errors.find((e) => e.msg.includes("INBOUND_AUTHSERV_ID"));
    expect(found).toBeDefined();
    expect(found?.ctx).toMatchObject({ user_id: USER });
  });
});
