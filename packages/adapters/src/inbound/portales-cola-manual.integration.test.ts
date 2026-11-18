import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, MANUAL_QUEUE_REASON, UNEXPECTED_SENDER_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/**
 * R13-3 · Un remitente esperado sin lector propio (el caso de ZonaJobs: `chooseParserName` lo manda
 * a `generic`, que no está registrado) llega a la cola manual con el cuerpo guardado, sin extraer
 * nada y sin caer en «remitente no esperado».
 *
 * Acá no se escriben direcciones completas de portales. Por eso el camino de handle.ts se ejercita
 * con un dominio ficticio que la persona marcó como fuente de empleo (misma rama `expected` +
 * `generic`); que `zonajobs.com.ar` sea esperado y que su parser sea `generic` se prueba aparte con
 * el dominio suelto (filter-leak.test.ts y bumeran.test.ts).
 */
const USER = "c9130000-0000-4000-8000-000000000003";
const ADDRESS = "u_r13_cola_manual@ingest.test";
const MARKED_DOMAIN = "portal-a.example";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const eventFrom = (emailId: string, from: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T05:05:29.000Z",
  data: {
    email_id: emailId,
    from,
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Novedades de tu búsqueda",
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
      inboundAddress: ADDRESS,
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
  await conn.db
    .insert(s.inboundSenderDomains)
    .values({ userId: USER, domain: MARKED_DOMAIN, verdict: "empleo" })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  // En el CI la base es compartida entre archivos: se deja como estaba
  if (conn) {
    await conn.db.delete(s.inboundEmails).where(eq(s.inboundEmails.userId, USER));
    await conn.db.delete(s.rawBlobs).where(eq(s.rawBlobs.userId, USER));
    await conn.db.delete(s.inboundSenderDomains).where(eq(s.inboundSenderDomains.userId, USER));
    await conn.db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, USER));
    await conn.db.delete(s.profiles).where(eq(s.profiles.userId, USER));
  }
  await conn?.close();
  await container?.stop();
});

async function storeAndRead(emailId: string, from: string, html: string) {
  const storage = pgBlobStorage(conn.db);
  const event = eventFrom(emailId, from);
  const out = await handleInboundEmail(
    event,
    { html, text: null, headers: null },
    JSON.stringify(event),
    { db: conn.db, storage, logger },
  );
  expect(out.kind).toBe("stored");
  if (out.kind !== "stored") throw new Error("no se guardó");
  const [row] = await conn.db
    .select()
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.id, out.inboundId));
  const raw = JSON.parse((await storage.get(row!.rawRef))!.body);
  return { out, row: row!, raw };
}

describe("R13-3: remitente esperado sin lector va a la cola manual con el cuerpo guardado", () => {
  it("cola manual, cuerpo completo, sin avisos extraídos y sin «remitente no esperado»", async () => {
    const { out, row, raw } = await storeAndRead(
      "em_sin_lector_1",
      `"Portal A" <avisos@${MARKED_DOMAIN}>`,
      "<p>Vacante de Analista en Empresa A</p>",
    );
    expect(out).toMatchObject({ jobsExtracted: 0, error: MANUAL_QUEUE_REASON });
    expect(row.error).not.toBe(UNEXPECTED_SENDER_REASON);
    expect(row.error).not.toContain("no esperado");
    expect(row.parser).toBe("none");
    expect(row.jobsExtracted).toBe(0);
    // Sigue pendiente para la persona (puede pegar el aviso): ni vista ni descartada
    expect(row.seenAt).toBeNull();
    expect(row.dismissedAt).toBeNull();
    expect(raw.content.html).toContain("Analista");
    expect(raw.redacted).toBeUndefined();
    const jobs = await conn.db
      .select({ id: s.jobs.id })
      .from(s.jobs)
      .where(eq(s.jobs.userId, USER));
    expect(jobs).toHaveLength(0);
  });

  it("contraste: un remitente no esperado se guarda sin cuerpo", async () => {
    const { row, raw } = await storeAndRead(
      "em_inesperado_1",
      '"Otro" <avisos@otro-portal.example>',
      "<p>Vacante de Analista en Empresa B</p>",
    );
    expect(row.error).toBe(UNEXPECTED_SENDER_REASON);
    expect(raw.content).toBeNull();
  });
});
