import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { processInboundEvent } from "./handle";
import { ResendFetchError, type ResendReceivedEvent } from "./resend";

/** El cuerpo del email se pide solo si hay un destino válido. Direcciones inventadas. */
const USER = "a0000000-0000-4000-8000-000000000516";
const ADDRESS = "u_a0000516@ingest.test";
const POOL_SENDER = "Alertas <alertas@portal.example.com>";
const pool = {
  enabled: true,
  ingestDomain: "ingest.test",
  senderDomains: ["portal.example.com"],
  careers: ["backend"],
};

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = (extra: { pool?: typeof pool } = {}) => ({
  db: conn.db,
  storage: pgBlobStorage(conn.db),
  logger,
  pool: { ...pool, enabled: false },
  ...extra,
});

const event = (
  emailId: string,
  to: string[],
  from = "Persona <persona@example.com>",
): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T12:00:00.000Z",
  data: {
    email_id: emailId,
    from,
    to,
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Asunto de prueba",
    attachments: [],
  },
});

const fetchSpy = () =>
  vi.fn(async () => ({ html: "<p>cuerpo</p>", text: "cuerpo", headers: null }));

async function stored(emailId: string): Promise<number> {
  const rows = await conn.db
    .select({ id: s.inboundEmails.id })
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.emailId, emailId));
  return rows.length;
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
  await conn.db.insert(s.profiles).values({
    userId: USER,
    displayName: "Destinatario",
    locationCountry: "AR",
    remoteOnly: true,
    inboundAddress: ADDRESS,
    profileSummary: "Perfil de prueba.",
  });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("processInboundEvent", () => {
  it("con un destinatario desconocido no pide el cuerpo", async () => {
    const fetchContent = fetchSpy();
    const ev = event("em_desconocido", ["u_nadie@ingest.test"]);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());
    expect(out).toEqual({ kind: "unknown_recipient", recipientsCount: 1 });
    expect(fetchContent).not.toHaveBeenCalled();
    expect(await stored("em_desconocido")).toBe(0);
  });

  it("sin destinatarios no pide el cuerpo", async () => {
    const fetchContent = fetchSpy();
    const ev = event("em_sin_destino", []);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());
    expect(out).toEqual({ kind: "unknown_recipient", recipientsCount: 0 });
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("con una persona conocida pide el cuerpo una vez y guarda el email", async () => {
    const fetchContent = fetchSpy();
    const ev = event("em_conocido", [`Persona <${ADDRESS.toUpperCase()}>`]);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());
    expect(out.kind).toBe("stored");
    expect(fetchContent).toHaveBeenCalledTimes(1);
    expect(await stored("em_conocido")).toBe(1);
  });

  it("un email ya guardado no vuelve a pedir el cuerpo", async () => {
    const ev = event("em_repetido", [ADDRESS]);
    await processInboundEvent(ev, JSON.stringify(ev), fetchSpy(), deps());
    const fetchContent = fetchSpy();
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());
    expect(out.kind).toBe("duplicate");
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("si pedir el cuerpo falla no guarda nada, para que el reintento lo procese", async () => {
    const ev = event("em_reintento", [ADDRESS]);
    const failing = vi.fn(async () => {
      throw new ResendFetchError(429, true);
    });
    await expect(
      processInboundEvent(ev, JSON.stringify(ev), failing, deps()),
    ).rejects.toBeInstanceOf(ResendFetchError);
    expect(await stored("em_reintento")).toBe(0);

    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchSpy(), deps());
    expect(out.kind).toBe("stored");
  });

  it("con la casilla del pool apagada no pide el cuerpo", async () => {
    const fetchContent = fetchSpy();
    const ev = event("em_pool_apagado", ["pool-backend@ingest.test"], POOL_SENDER);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());
    expect(out.kind).toBe("unknown_recipient");
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("con una casilla del pool inexistente o un remitente ajeno no pide el cuerpo", async () => {
    const fetchContent = fetchSpy();
    const otherCareer = event("em_pool_carrera", ["pool-inexistente@ingest.test"], POOL_SENDER);
    const otherSender = event("em_pool_remitente", ["pool-backend@ingest.test"]);
    for (const ev of [otherCareer, otherSender]) {
      const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps({ pool }));
      expect(out.kind).toBe("unknown_recipient");
    }
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("con una casilla del pool válida pide el cuerpo", async () => {
    const fetchContent = fetchSpy();
    const ev = event("em_pool_ok", ["pool-backend@ingest.test"], POOL_SENDER);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps({ pool }));
    expect(out.kind).toBe("pool_queued");
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });
});
