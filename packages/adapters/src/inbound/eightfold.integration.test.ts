import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/**
 * Email de Eightfold por el webhook, con datos sintéticos. Dedup por (fuente, pid): el mismo
 * aviso en dos emails (o el mismo email dos veces) es una sola oferta; otro pid del mismo tenant
 * es otra oferta.
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const HTML = readFileSync(resolve(__dirname, "fixtures/eightfold-match.html"), "utf8");
const OTRO_PID = HTML.replace("pid=900100200300", "pid=900100200399");

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-10-09T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: '"Eightfold" <notifications@mail.eightfold.ai>',
    to: ["u_a0000000@ingest.test"],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "This job is a match",
    attachments: [],
  },
});

const send = (emailId: string, html: string) =>
  handleInboundEmail(
    event(emailId),
    { html, text: null, headers: null },
    JSON.stringify(event(emailId)),
    { db: conn.db, storage: pgBlobStorage(conn.db), logger },
  );

async function jobsDeEightfold() {
  const rows = await conn.db
    .select({ jobId: s.jobSources.jobId, externalId: s.jobSources.externalId })
    .from(s.jobSources)
    .where(eq(s.jobSources.sourceName, "Eightfold (email)"));
  return rows;
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
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a0000000@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
  // Eightfold todavía no es fuente esperada de fábrica: la persona lo marcó como fuente de empleo
  await conn.db
    .insert(s.inboundSenderDomains)
    .values({ userId: USER, domain: "eightfold.ai", verdict: "empleo" })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("email de Eightfold por el webhook", () => {
  it("extrae el aviso, lo enlaza al crudo completo y lo deja pendiente de JD", async () => {
    const out = await send("em_ef_1", HTML);
    expect(out).toMatchObject({
      kind: "stored",
      parser: "eightfold",
      jobsExtracted: 1,
      error: null,
    });
    if (out.kind !== "stored") return;

    const [email] = await conn.db
      .select({ rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    const [src] = await conn.db
      .select()
      .from(s.jobSources)
      .where(eq(s.jobSources.externalId, "eightfold:empresa-ficticia:900100200300"));
    expect(src).toMatchObject({
      kind: "email_generic",
      sourceName: "Eightfold (email)",
      rawRef: email!.rawRef,
      url: "https://empresa-ficticia.eightfold.ai/careers/apply?pid=900100200300&domain=empresa-ficticia.example",
    });
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.id, src!.jobId));
    expect(job).toMatchObject({
      title: "Analista de Datos Semi Senior",
      companyRaw: "Empresa Ficticia",
      jdText: null,
    });
  });

  it("el mismo email dos veces deja una sola oferta", async () => {
    await send("em_ef_2", HTML);
    const rows = (await jobsDeEightfold()).filter(
      (r) => r.externalId === "eightfold:empresa-ficticia:900100200300",
    );
    expect(new Set(rows.map((r) => r.jobId)).size).toBe(1);
  });

  it("dos emails con el mismo pid (con otro tracking) son una sola oferta", async () => {
    await send("em_ef_3", HTML.replace("trk=abc123", "trk=otro"));
    const rows = await jobsDeEightfold();
    expect(new Set(rows.map((r) => r.jobId)).size).toBe(1);
  });

  it("otro pid del mismo tenant es otra oferta", async () => {
    const out = await send("em_ef_4", OTRO_PID);
    expect(out).toMatchObject({ kind: "stored", parser: "eightfold", jobsExtracted: 1 });
    const rows = await jobsDeEightfold();
    expect(new Set(rows.map((r) => r.jobId)).size).toBe(2);
    expect(rows.map((r) => r.externalId)).toContain("eightfold:empresa-ficticia:900100200399");
  });

  it("un email que el parser no reconoce va a la cola manual, sin ofertas", async () => {
    const out = await send("em_ef_5", HTML.replace("pid=900100200300", "sinpid=1"));
    expect(out).toMatchObject({ kind: "stored", parser: "eightfold", jobsExtracted: 0 });
    if (out.kind !== "stored") return;
    expect(out.error).toMatch(/estructura no reconocida \(eightfold\)/);
    expect((await jobsDeEightfold()).length).toBeGreaterThanOrEqual(2);
  });
});
