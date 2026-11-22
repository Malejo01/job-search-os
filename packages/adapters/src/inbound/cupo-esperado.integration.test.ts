import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** El cupo «esperado» lo llena lo que resultó de un portal, no lo que dice venir de uno. */
const USER = "a0000000-0000-4000-8000-0000000000e1";
const USER_B = "a0000000-0000-4000-8000-0000000000e2";
const USER_C = "a0000000-0000-4000-8000-0000000000e3";
const addressOf = (user: string) => `u_${user.slice(-8)}@ingest.test`;
const PORTAL = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({
  db: conn.db,
  storage: pgBlobStorage(conn.db),
  logger,
  authservId: "mx.example",
  dmarcMode: "log" as const,
});

const event = (emailId: string, user: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: PORTAL,
    to: [addressOf(user)],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "AI Engineer: 3 nuevas ofertas",
    attachments: [],
  },
});

const realHtml = () =>
  readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8");

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
  for (const user of [USER, USER_B, USER_C]) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId: user,
        displayName: "Cupo esperado",
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

describe("cupo esperado", () => {
  it("300 emails con From de portal y contenido ilegible no dejan sin cupo al correo real", async () => {
    for (let i = 0; i < 300; i++) {
      const ev = event(`em_basura_${i}`, USER);
      await handleInboundEmail(
        ev,
        { html: "<p>contenido sin la estructura de una alerta</p>", text: null, headers: null },
        JSON.stringify(ev),
        deps(),
      );
    }

    const real = event("em_real_despues", USER);
    const out = await handleInboundEmail(
      real,
      { html: realHtml(), text: null, headers: null },
      JSON.stringify(real),
      deps(),
    );

    expect(out.kind).toBe("stored");
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_real_despues"));
    expect(row?.error ?? "").not.toMatch(/estructura no reconocida/);
  });

  it("un email real de un portal sigue contando en el cupo esperado", async () => {
    const first = event("em_esperado_1", USER_B);
    const second = event("em_esperado_2", USER_B);
    const content = { html: realHtml(), text: null, headers: null };

    const a = await handleInboundEmail(first, content, JSON.stringify(first), {
      ...deps(),
      hourlyLimit: 1,
    });
    const b = await handleInboundEmail(second, content, JSON.stringify(second), {
      ...deps(),
      hourlyLimit: 1,
    });

    expect(a.kind).toBe("stored");
    expect(b.kind).toBe("rate_limited");
  });

  it("uno con autenticación verificada también cuenta en el cupo esperado", async () => {
    const headers = { "Authentication-Results": "mx.example; dmarc=pass header.from=linkedin.com" };
    const content = { html: realHtml(), text: null, headers };
    const first = event("em_pass_1", USER_C);
    const second = event("em_pass_2", USER_C);

    const a = await handleInboundEmail(first, content, JSON.stringify(first), {
      ...deps(),
      hourlyLimit: 1,
    });
    const b = await handleInboundEmail(second, content, JSON.stringify(second), {
      ...deps(),
      hourlyLimit: 1,
    });

    expect(a.kind).toBe("stored");
    expect(b.kind).toBe("rate_limited");
  });
});
