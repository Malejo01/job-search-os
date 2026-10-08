import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestBatch } from "../ingest/ingest-job";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, UNEXPECTED_SENDER_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/**
 * JS-098 · Dos usuarios en la ingesta: un webhook con destinatarios de A y de B va a un solo
 * usuario, un email_id repetido es duplicado, y el log de un fallo de ingesta (JS-107). Datos
 * inventados.
 */
const A = "a9000000-0000-4000-8000-000000000001";
const B = "b9000000-0000-4000-8000-000000000002";
const ADDR_A = "u_dos_a@ingest.test";
const ADDR_B = "u_dos_b@ingest.test";
const FROM = "Equipo de Prueba <jobs@example.com>";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const event = (emailId: string, to: string[]): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-10-08T12:00:00.000Z",
  data: {
    email_id: emailId,
    from: FROM,
    to,
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Aviso ficticio",
    attachments: [],
  },
});

const emailsOf = (userId: string) =>
  conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.userId, userId));

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
  for (const [userId, addr] of [
    [A, ADDR_A],
    [B, ADDR_B],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Persona de Prueba",
        locationCountry: "AR",
        inboundAddress: addr,
        profileSummary: "Perfil ficticio.",
      })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.delete(s.inboundEmails).where(inArray(s.inboundEmails.userId, [A, B]));
    await conn.db.delete(s.rawBlobs).where(inArray(s.rawBlobs.userId, [A, B]));
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, [A, B]));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, [A, B]));
  }
  await conn?.close();
  await container?.stop();
});

describe("webhook con dos usuarios", () => {
  it("un email dirigido a A y a B a la vez se guarda para un solo usuario; el reintento es duplicado", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_dos_1", [ADDR_A, ADDR_B]);
    const raw = JSON.stringify(ev);
    const out = await handleInboundEmail(
      ev,
      { html: null, text: "hola", headers: null },
      raw,
      deps,
    );
    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    expect([A, B]).toContain(out.userId);

    const mine = await emailsOf(A);
    const theirs = await emailsOf(B);
    expect(mine.length + theirs.length).toBe(1);

    const again = await handleInboundEmail(ev, null, raw, deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
    expect((await emailsOf(A)).length + (await emailsOf(B)).length).toBe(1);
  });

  it("A en `to` y B en `cc`: se guarda para un solo usuario, sin duplicar, y el otro no ve nada", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = {
      ...event("em_dos_cc", [ADDR_A]),
      data: { ...event("x", []).data, email_id: "em_dos_cc", to: [ADDR_A], cc: [ADDR_B] },
    };
    const raw = JSON.stringify(ev);
    const out = await handleInboundEmail(ev, null, raw, deps);
    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    const [forA, forB] = [
      (await emailsOf(A)).filter((e) => e.subject === "Aviso ficticio" && e.rawRef),
      (await emailsOf(B)).filter((e) => e.subject === "Aviso ficticio" && e.rawRef),
    ];
    const ids = [...forA, ...forB].filter((e) => e.id === out.inboundId);
    expect(ids).toHaveLength(1); // una sola fila, de un solo usuario
    const owner = forA.some((e) => e.id === out.inboundId) ? A : B;
    expect(out.userId).toBe(owner);
    const again = await handleInboundEmail(ev, null, raw, deps);
    expect(again).toMatchObject({ kind: "duplicate", inboundId: out.inboundId });
    // El otro usuario no tiene ningún crudo de este email_id
    const other = owner === A ? B : A;
    const blobs = await conn.db.select().from(s.rawBlobs).where(eq(s.rawBlobs.userId, other));
    expect(blobs.filter((b) => b.body.includes("em_dos_cc"))).toEqual([]);
  });

  it.todo("destinatario de to gana sobre cc (JS-117)");

  it("remitente no esperado: el aviso de privacidad queda en inbound_emails.error", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const ev = event("em_dos_2", [ADDR_B]);
    const out = await handleInboundEmail(
      ev,
      { html: "<p>cuerpo ficticio</p>", text: "cuerpo ficticio", headers: null },
      JSON.stringify(ev),
      deps,
    );
    expect(out).toMatchObject({ kind: "stored", userId: B });
    if (out.kind !== "stored") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row!.error).toBe(UNEXPECTED_SENDER_REASON);
    const blob = await pgBlobStorage(conn.db).get(row!.rawRef);
    expect(blob!.body).not.toContain("cuerpo ficticio");
  });

  it("el mismo email_id llegando a otro usuario no crea filas de más ni toca las del primero", async () => {
    const deps = { db: conn.db, storage: pgBlobStorage(conn.db), logger };
    const evA = event("em_dos_3", [ADDR_A]);
    const first = await handleInboundEmail(evA, null, JSON.stringify(evA), deps);
    expect(first).toMatchObject({ kind: "stored", userId: A });
    const before = (await emailsOf(A)).length;
    const evB = event("em_dos_3", [ADDR_B]);
    const second = await handleInboundEmail(evB, null, JSON.stringify(evB), deps);
    // Un email_id es único en Resend: repetido = duplicado, sin filas nuevas ni para A ni para B
    expect(second.kind).toBe("duplicate");
    expect((await emailsOf(A)).length).toBe(before);
    expect((await emailsOf(B)).filter((e) => e.rawRef.length > 0).length).toBeLessThanOrEqual(1);
  });
});

describe("log de un fallo de ingesta", () => {
  // pendiente (JS-107 ampliado); al cerrarlo, quitar el `.fails`
  const lines: string[] = [];
  let failed = 0;

  it("el insert del caso falla de verdad (precondición, JS-107)", async () => {
    const spy = pino({ level: "debug" }, { write: (chunk: string) => void lines.push(chunk) });
    const secretJd = "TextoFicticioDeLaJD-Zorro-Violeta-4471 requisitos ficticios para la oferta.";
    // Un NUL en el título hace fallar el INSERT de jobs (Postgres no admite 0x00 en text)
    const raw = rawJobFromManual({
      url: "https://empresa-a.example/jobs/dos-1",
      title: "Titulo\u0000roto",
      company: "Empresa A",
      locationRaw: "Remoto (Argentina)",
      modality: "remoto",
      jdText: secretJd,
    });
    const summary = await ingestBatch([raw], {
      db: conn.db,
      userId: A,
      rules: criteria as never,
      logger: spy,
    });
    failed = summary.errors.length;
    expect(failed).toBe(1);
  });

  it.fails(
    "el log de un fallo de ingesta no incluye datos de la oferta (JS-107, pendiente)",
    () => {
      expect(failed).toBe(1);
      expect(lines.join("\n")).not.toContain("Zorro-Violeta-4471");
    },
  );
});
