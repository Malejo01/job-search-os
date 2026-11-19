import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, processInboundEvent } from "./handle";
import { linkedinParser } from "./linkedin";
import type { ResendReceivedEvent } from "./resend";

/** Un email que no se puede leer termina en la cola manual, nunca en un error del webhook. Datos inventados. */
const USER = "a0000000-0000-4000-8000-000000000529";
const ADDRESS = "u_a0000529@ingest.test";
const EXPECTED_FROM = "LinkedIn <jobs-noreply@linkedin.com>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });

const event = (
  emailId: string,
  overrides: Partial<ResendReceivedEvent["data"]> = {},
): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-11-18T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: EXPECTED_FROM,
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Ofertas nuevas",
    attachments: [],
    ...overrides,
  },
});

const content = { html: "<p>cuerpo</p>", text: "cuerpo", headers: null };

async function row(emailId: string) {
  const [found] = await conn.db
    .select()
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.emailId, emailId));
  return found;
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
    displayName: "Cola manual",
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

describe("email que no se puede leer", () => {
  it("si el parser lanza, el email queda en la cola manual", async () => {
    const parse = vi.spyOn(linkedinParser, "parse").mockImplementation(() => {
      throw new RangeError("dato fuera de rango");
    });
    const ev = event("em_parser_lanza");
    const out = await handleInboundEmail(ev, content, JSON.stringify(ev), deps());
    parse.mockRestore();

    expect(out).toMatchObject({ kind: "stored", jobsExtracted: 0 });
    const saved = await row("em_parser_lanza");
    expect(saved?.error).toMatch(/estructura no reconocida .*cola manual/i);
    expect(saved?.error).not.toContain("dato fuera de rango");
  });

  it("un carácter nulo en el asunto y el remitente no impide guardar el email", async () => {
    const ev = event("em_nulo_asunto", {
      subject: "Ofertas\u0000 nuevas",
      from: "Persona\u0000 <persona@example.com>",
    });
    const out = await handleInboundEmail(ev, content, JSON.stringify(ev), deps());

    expect(out.kind).toBe("stored");
    const saved = await row("em_nulo_asunto");
    expect(saved?.subject).toBe("Ofertas nuevas");
    expect(saved?.fromAddress).toBe("Persona <persona@example.com>");
  });

  it("un carácter nulo en el destinatario no rompe la búsqueda de la persona", async () => {
    const ev = event("em_nulo_destino", { to: [`${ADDRESS}\u0000`] });
    const fetchContent = vi.fn(async () => content);
    const out = await processInboundEvent(ev, JSON.stringify(ev), fetchContent, deps());

    expect(out.kind).toBe("stored");
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("un carácter nulo en el cuerpo no llega al parser", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_nulo_cuerpo");
    const out = await handleInboundEmail(
      ev,
      { html: "<p>cue\u0000rpo</p>", text: "cue\u0000rpo", headers: null },
      JSON.stringify(ev),
      deps(),
    );
    const received = parse.mock.calls[0]?.[0];
    parse.mockRestore();

    expect(out.kind).toBe("stored");
    expect(received?.html).toBe("<p>cuerpo</p>");
    expect(received?.text).toBe("cuerpo");
  });
});
