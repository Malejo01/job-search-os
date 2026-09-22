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
 * JS-047 · El email de Indeed entra por el webhook: se guarda completo (Indeed es fuente
 * esperada, JS-051), el parser extrae el aviso y queda enlazado al crudo del email (JS-024).
 */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const HTML = readFileSync(
  resolve(__dirname, "fixtures/indeed/indeed-remoto-con-sueldo.html"),
  "utf8",
);
const event: ResendReceivedEvent = {
  type: "email.received",
  created_at: "2026-09-22T05:05:29.000Z",
  data: {
    email_id: "em_indeed_1",
    from: '"Indeed" <donotreply@match.indeed.com>',
    to: ["u_a0000000@ingest.test"],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Soporte Técnico – Guardias Remotas en Empresa Norte IT",
    attachments: [],
  },
};

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
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("JS-047: email de Indeed por el webhook", () => {
  it("extrae el aviso, lo enlaza al crudo completo y no inventa el sueldo en USD", async () => {
    const storage = pgBlobStorage(conn.db);
    const out = await handleInboundEmail(
      event,
      { html: HTML, text: null, headers: null },
      JSON.stringify(event),
      { db: conn.db, storage, logger },
    );
    expect(out).toMatchObject({ kind: "stored", parser: "indeed", jobsExtracted: 1, error: null });
    if (out.kind !== "stored") return;

    const [email] = await conn.db
      .select({ rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    // Indeed es fuente esperada: el crudo se guarda completo (JS-051)
    expect(JSON.parse((await storage.get(email!.rawRef))!.body).content.html).toContain("Guardias");

    const [job] = await conn.db
      .select()
      .from(s.jobs)
      .where(eq(s.jobs.canonicalUrl, "https://ar.indeed.com/viewjob?jk=fedcba9876543210"));
    expect(job).toMatchObject({
      title: "Soporte Técnico – Guardias Remotas",
      companyRaw: "Empresa Norte IT",
      modality: "remoto",
      salaryMinUsd: null,
      jdText: null,
    });
    const [src] = await conn.db.select().from(s.jobSources).where(eq(s.jobSources.jobId, job!.id));
    expect(src).toMatchObject({
      kind: "email_generic",
      sourceName: "Indeed (email)",
      rawRef: email!.rawRef,
    });
  });
});
