import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { processInboundEvent } from "./handle";
import type { ReceivedEmailContent, ResendReceivedEvent } from "./resend";

/**
 * El cupo se decide antes de pedir el cuerpo a Resend: un remitente de portal cuyo contenido ya salió
 * ilegible no vuelve a costar una llamada ni un guardado cuando el cupo de no esperados está lleno.
 */
const USER_A = "a0000000-0000-4000-8000-0000000000f1";
const USER_B = "a0000000-0000-4000-8000-0000000000f2";
const USER_C = "a0000000-0000-4000-8000-0000000000f3";
const addressOf = (user: string) => `u_${user.slice(-8)}@ingest.test`;
const PORTAL = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>";
const OTHER_PORTAL = "LinkedIn Jobs <jobs-listings@linkedin.com>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = (extra: { hourlyLimit?: number } = {}) => ({
  db: conn.db,
  storage: pgBlobStorage(conn.db),
  logger,
  authservId: "mx.example",
  dmarcMode: "log" as const,
  ...extra,
});

const event = (emailId: string, user: string, from = PORTAL): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-22T12:00:00.000Z",
  data: {
    email_id: emailId,
    from,
    to: [addressOf(user)],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "AI Engineer: 3 nuevas ofertas",
    attachments: [],
  },
});

const garbage = async (): Promise<ReceivedEmailContent> => ({
  html: "<p>contenido sin la estructura de una alerta</p>",
  text: null,
  headers: null,
});
const realHtml = () =>
  readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8");

const process_ = (
  ev: ResendReceivedEvent,
  fetchContent: () => Promise<ReceivedEmailContent | null>,
  extra: { hourlyLimit?: number } = {},
) => processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps(extra));

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
  for (const user of [USER_A, USER_B, USER_C]) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId: user,
        displayName: "Cupo antes del cuerpo",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: addressOf(user),
        profileSummary: "AI Engineer.",
      })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("cupo antes de pedir el cuerpo", () => {
  it("con el cupo de no esperados lleno, un remitente de portal ilegible no pide el cuerpo", async () => {
    const limits = { hourlyLimit: 2 };
    for (const id of ["em_ilegible_1", "em_ilegible_2"]) {
      const out = await process_(event(id, USER_A), garbage, limits);
      expect(out.kind).toBe("stored");
    }

    const fetchContent = vi.fn(garbage);
    const out = await process_(event("em_ilegible_3", USER_A), fetchContent, limits);

    expect(out.kind).toBe("rate_limited");
    expect(fetchContent).not.toHaveBeenCalled();
    const rows = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_ilegible_3"));
    expect(rows).toHaveLength(0);
  });

  it("otro remitente de portal sin ilegibles recientes sigue pidiendo el cuerpo", async () => {
    const limits = { hourlyLimit: 2 };
    for (const id of ["em_otro_1", "em_otro_2"]) {
      await process_(event(id, USER_B), garbage, limits);
    }

    const fetchContent = vi.fn(async () => ({ html: realHtml(), text: null, headers: null }));
    const out = await process_(event("em_otro_real", USER_B, OTHER_PORTAL), fetchContent, limits);

    expect(fetchContent).toHaveBeenCalledTimes(1);
    expect(out.kind).not.toBe("duplicate");
  });
});

describe("reintentos de un remitente con ilegibles", () => {
  const countRows = async () =>
    (await conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.userId, USER_C))).length;
  const countBlobs = async () =>
    (await conn.db.select().from(s.rawBlobs).where(eq(s.rawBlobs.userId, USER_C))).length;

  it("cada reintento se rechaza sin pedir el cuerpo ni escribir filas ni crudos", async () => {
    const limits = { hourlyLimit: 2 };
    for (const id of ["em_reintento_1", "em_reintento_2"]) {
      await process_(event(id, USER_C), garbage, limits);
    }
    const rowsBefore = await countRows();
    const blobsBefore = await countBlobs();

    const fetchContent = vi.fn(garbage);
    const ev = event("em_reintento_3", USER_C);
    const first = await process_(ev, fetchContent, limits);
    const retry = await process_(ev, fetchContent, limits);

    expect(first.kind).toBe("rate_limited");
    expect(retry.kind).toBe("rate_limited");
    expect(fetchContent).not.toHaveBeenCalled();
    expect(await countRows()).toBe(rowsBefore);
    expect(await countBlobs()).toBe(blobsBefore);
  });
});
