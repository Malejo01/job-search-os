import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import {
  AUTH_UNVERIFIED_REASON,
  handleInboundEmail,
  processHeldInbound,
  UNEXPECTED_SENDER_REASON,
} from "./handle";
import { linkedinParser } from "./linkedin";
import { chooseParserName, linkedinSenderKind } from "./parsers";
import { isPoolAlertSender } from "./pool-mailbox";
import type { ResendReceivedEvent } from "./resend";

/** Lectura del remitente en el webhook. Remitentes y direcciones inventados. */
const USER = "a0000000-0000-4000-8000-000000000505";
const ADDRESS = "u_a0000505@ingest.test";
const SPOOF = '"LinkedIn <jobs-noreply@linkedin.com>" <bot@otro.example>';
const REAL = "LinkedIn <jobs-noreply@linkedin.com>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const deps = () => ({
  db: conn.db,
  storage: pgBlobStorage(conn.db),
  logger,
  authservId: "mx.example",
});

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
    subject: "AI Engineer: nuevas ofertas",
    attachments: [],
  },
});

async function storedBody(inboundId: string): Promise<string> {
  const [row] = await conn.db
    .select()
    .from(s.inboundEmails)
    .where(eq(s.inboundEmails.id, inboundId));
  return (await deps().storage.get(row!.rawRef))!.body;
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
    displayName: "Remitente",
    locationCountry: "AR",
    remoteOnly: true,
    inboundAddress: ADDRESS,
    profileSummary: "AI Engineer.",
  });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("remitente del webhook", () => {
  it("con la dirección en el nombre visible guarda solo metadatos y no usa el parser", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_from_nombre", SPOOF);

    const out = await handleInboundEmail(
      ev,
      { html: "<p>cuerpo-del-email</p>", text: "cuerpo-del-email", headers: null },
      JSON.stringify(ev),
      deps(),
    );

    expect(out).toMatchObject({ kind: "stored", error: UNEXPECTED_SENDER_REASON });
    expect(parse).not.toHaveBeenCalled();
    if (out.kind === "stored") expect(await storedBody(out.inboundId)).not.toContain("cuerpo-del");
    parse.mockRestore();
  });

  const content = (authResults: string | null) => ({
    html: "<p>cuerpo-del-email</p>",
    text: "cuerpo-del-email",
    headers: authResults ? { "Authentication-Results": authResults } : null,
  });

  it("en modo log, un veredicto fallido se registra y el email se procesa igual", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_auth_log", REAL);

    const out = await handleInboundEmail(
      ev,
      content("mx.example; dmarc=fail"),
      JSON.stringify(ev),
      deps(),
    );

    expect(parse).toHaveBeenCalledTimes(1);
    expect(out.kind).toBe("stored");
    if (out.kind === "stored") {
      expect(out.error).not.toBe(AUTH_UNVERIFIED_REASON);
      expect(JSON.parse(await storedBody(out.inboundId)).auth_verdict).toBe("fail");
    }
    parse.mockRestore();
  });

  it.each([
    ["fallido", "em_auth_fail", "mx.example; dmarc=fail"],
    ["ausente", "em_auth_none", null],
  ])("en modo enforce, con veredicto %s guarda el cuerpo y no procesa", async (_, id, auth) => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event(id, REAL);

    const out = await handleInboundEmail(ev, content(auth), JSON.stringify(ev), {
      ...deps(),
      dmarcMode: "enforce",
    });

    expect(out).toMatchObject({
      kind: "stored",
      jobsExtracted: 0,
      error: AUTH_UNVERIFIED_REASON,
    });
    expect(parse).not.toHaveBeenCalled();
    if (out.kind === "stored") expect(await storedBody(out.inboundId)).toContain("cuerpo-del");
    parse.mockRestore();
  });

  it("en modo enforce, con autenticación verificada se procesa", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_auth_ok", REAL);

    await handleInboundEmail(
      ev,
      content("mx.example; dmarc=pass header.from=linkedin.com"),
      JSON.stringify(ev),
      { ...deps(), dmarcMode: "enforce" },
    );

    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });

  it("en modo enforce, sin authserv-id configurado un dmarc=pass escrito por quien envía no alcanza", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_auth_sin_id", REAL);

    const out = await handleInboundEmail(
      ev,
      content("mx.example; dmarc=pass header.from=linkedin.com"),
      JSON.stringify(ev),
      { ...deps(), authservId: undefined, dmarcMode: "enforce" },
    );

    expect(out).toMatchObject({ kind: "stored", error: AUTH_UNVERIFIED_REASON });
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  describe("procesar igual un email retenido", () => {
    const heldEmail = async (id: string) => {
      const ev = event(id, REAL);
      const out = await handleInboundEmail(ev, content(null), JSON.stringify(ev), {
        ...deps(),
        dmarcMode: "enforce",
      });
      if (out.kind !== "stored") throw new Error("se esperaba un email guardado");
      return out.inboundId;
    };
    const rowsByEmail = (id: string) =>
      conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.emailId, id));

    it("lo procesa como verificado y reemplaza la fila retenida", async () => {
      const heldId = await heldEmail("em_retenido_ok");
      const parse = vi.spyOn(linkedinParser, "parse");

      const out = await processHeldInbound(heldId, USER, { ...deps(), dmarcMode: "enforce" });

      expect(out).toMatchObject({ ok: true });
      expect(parse).toHaveBeenCalledTimes(1);
      const rows = await rowsByEmail("em_retenido_ok");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).not.toBe(heldId);
      expect(rows[0]!.error).not.toBe(AUTH_UNVERIFIED_REASON);
      const old = await conn.db
        .select()
        .from(s.inboundEmails)
        .where(eq(s.inboundEmails.id, heldId));
      expect(old).toHaveLength(0);
      parse.mockRestore();
    });

    it("no procesa el email de otra persona", async () => {
      const heldId = await heldEmail("em_retenido_ajeno");
      const parse = vi.spyOn(linkedinParser, "parse");

      const out = await processHeldInbound(heldId, "a0000000-0000-4000-8000-0000000005ff", {
        ...deps(),
        dmarcMode: "enforce",
      });

      expect(out).toMatchObject({ ok: false });
      expect(parse).not.toHaveBeenCalled();
      const [row] = await rowsByEmail("em_retenido_ajeno");
      expect(row?.id).toBe(heldId);
      expect(row?.error).toBe(AUTH_UNVERIFIED_REASON);
      parse.mockRestore();
    });

    it("no procesa un email que no estaba retenido", async () => {
      const ev = event("em_no_retenido", REAL);
      const stored = await handleInboundEmail(ev, content(null), JSON.stringify(ev), deps());
      if (stored.kind !== "stored") throw new Error("se esperaba un email guardado");

      const out = await processHeldInbound(stored.inboundId, USER, deps());

      expect(out).toMatchObject({ ok: false });
    });

    it("si el procesamiento queda limitado por el cupo, el email sigue retenido", async () => {
      const heldId = await heldEmail("em_retenido_cupo");

      const out = await processHeldInbound(heldId, USER, {
        ...deps(),
        dmarcMode: "enforce",
        hourlyLimit: 1,
      });

      expect(out).toMatchObject({ ok: false });
      const [row] = await rowsByEmail("em_retenido_cupo");
      expect(row?.id).toBe(heldId);
    });
  });

  it("en modo off no registra veredicto", async () => {
    const ev = event("em_auth_off", REAL);

    const out = await handleInboundEmail(
      ev,
      content("mx.example; dmarc=fail"),
      JSON.stringify(ev),
      {
        ...deps(),
        dmarcMode: "off",
      },
    );

    if (out.kind === "stored") {
      expect(JSON.parse(await storedBody(out.inboundId)).auth_verdict).toBeUndefined();
    }
  });

  it("sin el encabezado de autenticación, un remitente esperado se guarda completo", async () => {
    const ev = event("em_sin_encabezado", REAL);

    const out = await handleInboundEmail(
      ev,
      { html: "<p>cuerpo-del-email</p>", text: "cuerpo-del-email", headers: null },
      JSON.stringify(ev),
      deps(),
    );

    expect(out.kind).toBe("stored");
    if (out.kind === "stored") expect(await storedBody(out.inboundId)).toContain("cuerpo-del");
  });
});

describe("elección del parser por remitente", () => {
  it("usa la dirección real", () => {
    expect(chooseParserName(REAL)).toBe("linkedin");
    expect(chooseParserName(SPOOF)).toBe("generic");
    expect(linkedinSenderKind(REAL)).toBe("empleo");
    expect(linkedinSenderKind(SPOOF)).toBeNull();
  });

  it("la casilla del pool tampoco acepta el dominio del nombre visible", () => {
    const domains = ["alertas.example"];
    expect(isPoolAlertSender("Alertas <a@alertas.example>", domains)).toBe(true);
    expect(isPoolAlertSender('"Alertas <a@alertas.example>" <bot@otro.example>', domains)).toBe(
      false,
    );
  });
});
