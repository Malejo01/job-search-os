import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import {
  EMAIL_MAX_CARDS,
  handleInboundEmail,
  MANUAL_QUEUE_REASON,
  OVERSIZE_EMAIL_REASON,
  TOO_MANY_CARDS_REASON,
  UNEXPECTED_SENDER_REASON,
  USER_RAW_MAX_BYTES,
} from "./handle";
import { linkedinParser } from "./linkedin";
import type { ResendReceivedEvent } from "./resend";

/** JS-020: email entrante → crudo en storage + fila en inbound_emails + despacho (cola manual sin parser). */
const USER = "a0000000-0000-4000-8000-000000000001";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const SIN_PARSER = "Equipo de Talento <jobs@example.com>";

const event = (
  emailId: string,
  to = "u_a0000000@ingest.test",
  from = "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-11T20:00:00.000Z",
  data: {
    email_id: emailId,
    from,
    to: [to],
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
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a0000000@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("topes del email de una persona", () => {
  const TOPES = "a0000000-0000-4000-8000-000000000002";
  const TOPES_ADDRESS = "u_a0000002@ingest.test";
  const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });

  beforeAll(async () => {
    await conn.db
      .insert(s.profiles)
      .values({
        userId: TOPES,
        displayName: "Topes",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: TOPES_ADDRESS,
        profileSummary: "AI Engineer.",
      })
      .onConflictDoNothing();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("un email de 5 MB de un remitente esperado guarda solo metadatos y no se procesa", async () => {
    const parse = vi.spyOn(linkedinParser, "parse");
    const ev = event("em_tope_bytes", TOPES_ADDRESS);
    const html = `<p>${"x".repeat(5 * 1024 * 1024)}</p>`;

    const out = await handleInboundEmail(
      ev,
      { html, text: null, headers: null },
      JSON.stringify(ev),
      deps(),
    );

    expect(out).toMatchObject({ kind: "stored", jobsExtracted: 0, error: OVERSIZE_EMAIL_REASON });
    expect(parse).not.toHaveBeenCalled();
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    const blob = await deps().storage.get(row!.rawRef);
    expect(Buffer.byteLength(blob!.body, "utf8")).toBeLessThan(2_000);
    expect(JSON.parse(blob!.body)).toMatchObject({
      content: null,
      redacted: OVERSIZE_EMAIL_REASON,
    });
  });

  it("un email justo debajo del tope se guarda completo", async () => {
    const ev = event("em_tope_justo", TOPES_ADDRESS);
    const raw = JSON.stringify(ev);
    const text = "y".repeat(USER_RAW_MAX_BYTES - Buffer.byteLength(raw, "utf8") - 10);

    const out = await handleInboundEmail(ev, { html: null, text, headers: null }, raw, deps());

    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    expect(out.error).not.toBe(OVERSIZE_EMAIL_REASON);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    const blob = await deps().storage.get(row!.rawRef);
    expect(JSON.parse(blob!.body).content.text).toBe(text);
  });

  it("un email con más tarjetas que el tope va a la cola manual sin cargar avisos", async () => {
    vi.spyOn(linkedinParser, "parse").mockReturnValue({
      ok: true,
      jobs: Array.from({ length: EMAIL_MAX_CARDS + 1 }, () => ({})),
    } as never);
    const ev = event("em_tope_tarjetas", TOPES_ADDRESS);

    const out = await handleInboundEmail(
      ev,
      { html: "<p>alerta</p>", text: "alerta", headers: null },
      JSON.stringify(ev),
      deps(),
    );

    expect(out).toMatchObject({ kind: "stored", jobsExtracted: 0, error: TOO_MANY_CARDS_REASON });
    const jobs = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, TOPES));
    expect(jobs).toHaveLength(0);
  });

  it("pasado el tope diario se rechaza y queda contado, aunque la última hora esté libre", async () => {
    const DIARIO = "a0000000-0000-4000-8000-000000000003";
    const DIARIO_ADDRESS = "u_a0000003@ingest.test";
    await conn.db.insert(s.profiles).values({
      userId: DIARIO,
      displayName: "Diario",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: DIARIO_ADDRESS,
      profileSummary: "AI Engineer.",
    });
    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
    const row = (receivedAt: Date) => ({
      userId: DIARIO,
      fromAddress: "x@example.com",
      rawRef: "pg:00000000-0000-4000-8000-000000000000",
      receivedAt,
    });
    await conn.db
      .insert(s.inboundEmails)
      .values([row(hoursAgo(25)), row(hoursAgo(3)), row(hoursAgo(2))]);
    const limited = { ...deps(), dailyLimit: 3 };

    const first = event("em_diario_1", DIARIO_ADDRESS, SIN_PARSER);
    expect((await handleInboundEmail(first, null, JSON.stringify(first), limited)).kind).toBe(
      "stored",
    );

    const second = event("em_diario_2", DIARIO_ADDRESS, SIN_PARSER);
    expect(await handleInboundEmail(second, null, JSON.stringify(second), limited)).toEqual({
      kind: "rate_limited",
      userId: DIARIO,
    });
    const rejections = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(eq(s.inboundRejections.userId, DIARIO));
    expect(rejections).toHaveLength(1);
  });
});

describe("handleInboundEmail", () => {
  it("remitente no esperado: guarda solo remitente, asunto y fecha, sin el cuerpo (JS-051); el reintento es idempotente", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const raw = JSON.stringify(event("em_1", undefined, SIN_PARSER));
    const out = await handleInboundEmail(
      event("em_1", undefined, SIN_PARSER),
      { html: "<p>hola</p>", text: "hola", headers: null },
      raw,
      deps,
    );
    expect(out).toMatchObject({
      kind: "stored",
      userId: USER,
      parser: null,
      jobsExtracted: 0,
      error: UNEXPECTED_SENDER_REASON,
    });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({
      fromAddress: expect.stringContaining("example.com"),
      subject: "AI Engineer: 3 nuevas ofertas",
      parser: "none",
    });
    const blob = await deps.storage.get(row!.rawRef);
    expect(blob?.contentType).toBe("application/json");
    const stored = JSON.parse(blob!.body);
    expect(stored).toMatchObject({
      event: { data: { email_id: "em_1", subject: "AI Engineer: 3 nuevas ofertas" } },
      content: null,
      redacted: expect.stringContaining("remitente no esperado"),
    });
    // Ni el cuerpo ni los adjuntos (sus nombres también pueden ser sensibles)
    expect(blob!.body).not.toContain("hola");
    expect(stored.event.data.attachments).toBeUndefined();

    const again = await handleInboundEmail(event("em_1", undefined, SIN_PARSER), null, raw, deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
  });

  it("guarda el email_id en su columna y lo reconoce sin mirar los crudos (JS-115)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_col_1", undefined, SIN_PARSER);
    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), deps);
    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select({ emailId: s.inboundEmails.emailId, rawRef: s.inboundEmails.rawRef })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row!.emailId).toBe("em_col_1");
    // Aunque el crudo ya no esté (o diga otra cosa), la columna alcanza para frenar el reintento
    await conn.db.delete(s.rawBlobs).where(eq(s.rawBlobs.id, row!.rawRef.replace(/^pg:/, "")));
    const again = await handleInboundEmail(ev, null, JSON.stringify(ev), deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
  });

  it("dos entregas del mismo email a la vez dejan una sola fila (JS-115)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_carrera_1", undefined, SIN_PARSER);
    const raw = JSON.stringify(ev);
    const results = await Promise.all([
      handleInboundEmail(ev, null, raw, deps),
      handleInboundEmail(ev, null, raw, deps),
      handleInboundEmail(ev, null, raw, deps),
    ]);
    expect(results.filter((r) => r.kind === "stored")).toHaveLength(1);
    expect(results.filter((r) => r.kind === "duplicate")).toHaveLength(2);
    const rows = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_carrera_1"));
    expect(rows).toHaveLength(1);
    const stored = results.find((r) => r.kind === "stored");
    for (const r of results.filter((x) => x.kind === "duplicate")) {
      expect(r).toMatchObject({ inboundId: (stored as { inboundId: string }).inboundId });
    }
  });

  it("la base no deja dos filas con el mismo email_id, pero sí varias sin él (JS-115)", async () => {
    const row = (emailId: string | null) => ({
      userId: USER,
      fromAddress: "x@example.com",
      rawRef: "pg:00000000-0000-4000-8000-000000000000",
      emailId,
    });
    await conn.db.insert(s.inboundEmails).values(row("em_unico_1"));
    await expect(conn.db.insert(s.inboundEmails).values(row("em_unico_1"))).rejects.toThrow();
    await conn.db.insert(s.inboundEmails).values([row(null), row(null)]);
  });

  it("un dominio marcado como fuente de empleo se guarda completo (JS-051)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    await conn.db
      .insert(s.inboundSenderDomains)
      .values({ userId: USER, domain: "reclutadora.example", verdict: "empleo" });
    const ev = event("em_marcado", undefined, "Talento <talento@mail.reclutadora.example>");
    const out = await handleInboundEmail(
      ev,
      {
        html: "<p>Tenemos una búsqueda para vos</p>",
        text: "Tenemos una búsqueda para vos",
        headers: null,
      },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", error: MANUAL_QUEUE_REASON });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    const blob = await deps.storage.get(row!.rawRef);
    expect(JSON.parse(blob!.body)).toMatchObject({
      content: { text: "Tenemos una búsqueda para vos" },
    });
  });

  it("marcado como «no es de empleo» sigue sin guardar el cuerpo (JS-051)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    await conn.db
      .insert(s.inboundSenderDomains)
      .values({ userId: USER, domain: "banco.example", verdict: "no_empleo" });
    const ev = event("em_no_empleo", undefined, "Banco <avisos@banco.example>");
    const out = await handleInboundEmail(
      ev,
      { html: "<p>Tu código es 123456</p>", text: "Tu código es 123456", headers: null },
      JSON.stringify(ev),
      deps,
    );
    if (out.kind !== "stored") throw new Error(out.kind);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect((await deps.storage.get(row!.rawRef))!.body).not.toContain("123456");
  });

  it("con parser pero estructura desconocida también va a cola manual, sin inventar ofertas (JS-021)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    // remitente de LinkedIn, pero el HTML no es una alerta con tarjetas de aviso
    const out = await handleInboundEmail(
      event("em_4"),
      { html: "<p>Tenés una nueva recomendación</p>", text: null, headers: null },
      JSON.stringify(event("em_4")),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", parser: "linkedin", jobsExtracted: 0 });
    if (out.kind !== "stored") return;
    expect(out.error).toMatch(/cola manual/i);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({ parser: "linkedin", jobsExtracted: 0 });
    expect(row!.error).toMatch(/cola manual/i);
  });

  it("notificación social de LinkedIn: se guarda como no relevante, descartada y con su crudo (JS-050)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_social_1", undefined, "LinkedIn <messages-noreply@linkedin.com>");
    const out = await handleInboundEmail(
      ev,
      { html: "<p>Una persona de tu red es popular</p>", text: null, headers: null },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({
      kind: "stored",
      parser: "linkedin_social",
      jobsExtracted: 0,
      error: null,
    });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row).toMatchObject({ parser: "linkedin_social", error: null });
    expect(row!.dismissedAt).not.toBeNull();
    expect(await deps.storage.get(row!.rawRef)).not.toBeNull();
  });

  it("si una notificación social trae tarjetas de aviso, queda pendiente para revisar la regla (JS-050)", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const html = readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8");
    const ev = event("em_social_2", undefined, "LinkedIn <invitations@linkedin.com>");
    const out = await handleInboundEmail(
      ev,
      { html, text: null, headers: null },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", parser: "linkedin_social", jobsExtracted: 0 });
    if (out.kind !== "stored") return;
    expect(out.error).toMatch(/revisar la regla/);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    // No se descarta ni se ingesta: la persona lo ve en Pendientes y decide
    expect(row!.dismissedAt).toBeNull();
    const jobs = await conn.db.select({ id: s.jobs.id }).from(s.jobs);
    expect(jobs).toHaveLength(0);
  });

  it("ignora destinatarios que no son de ningún usuario y aplica rate limit por hora", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const unknown = await handleInboundEmail(event("em_2", "nadie@ingest.test"), null, "{}", deps);
    expect(unknown).toMatchObject({ kind: "unknown_recipient" });
    const limited = await handleInboundEmail(event("em_3"), null, JSON.stringify(event("em_3")), {
      ...deps,
      hourlyLimit: 1,
    });
    expect(limited).toMatchObject({ kind: "rate_limited", userId: USER });
    const again = await handleInboundEmail(event("em_5"), null, JSON.stringify(event("em_5")), {
      ...deps,
      hourlyLimit: 1,
    });
    expect(again).toMatchObject({ kind: "rate_limited", userId: USER });
    // JS-038: los rechazados no se guardan, pero quedan contados por usuario y hora
    const rejections = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(eq(s.inboundRejections.userId, USER));
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.rejected).toBe(2);
  });
});
