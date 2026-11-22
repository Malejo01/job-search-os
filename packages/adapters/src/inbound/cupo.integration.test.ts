import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, PROCESSING_REASON } from "./handle";
import type { ResendReceivedEvent } from "./resend";

/** El intento se cuenta antes de leer el contenido: un email que falla o cuelga igual ocupa cupo. */
const USER = "a0000000-0000-4000-8000-0000000000c1";
const ADDRESS = "u_c1000000@ingest.test";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const event = (emailId: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-09-11T20:00:00.000Z",
  data: {
    email_id: emailId,
    from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
    to: [ADDRESS],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Empresa A viewed your application",
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
      displayName: "Cupo",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: ADDRESS,
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("cupo por intento", () => {
  const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });
  const rowsOf = (emailId: string) =>
    conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.emailId, emailId));

  it("un email que falla al guardar el crudo queda retomable (una sola fila) y el reintento lo procesa", async () => {
    const ev = event("em_cupo_falla");
    const storage = pgBlobStorage(conn.db);
    const put = vi.spyOn(storage, "put").mockRejectedValueOnce(new Error("storage caído"));

    await expect(
      handleInboundEmail(ev, null, JSON.stringify(ev), { ...deps(), storage }),
    ).rejects.toThrow("storage caído");
    // La provisional no se borra: queda en `pending:` y ya vencida, así el reintento la toma sin perder el email
    const [left] = await rowsOf("em_cupo_falla");
    expect(left?.rawRef).toBe("pending:");
    put.mockRestore();

    const retry = await handleInboundEmail(ev, null, JSON.stringify(ev), deps());
    expect(retry.kind).toBe("stored");
    expect(await rowsOf("em_cupo_falla")).toHaveLength(1);
  });

  it("una fila provisional (función colgada) cuenta para el límite y el reintento es un duplicado", async () => {
    const hung = event("em_cupo_colgado");
    // Lo que deja una función que murió a mitad del procesamiento
    await conn.db.insert(s.inboundEmails).values({
      userId: USER,
      emailId: "em_cupo_colgado",
      fromAddress: "x@example.com",
      rawRef: "pending:",
      parser: "none",
      error: PROCESSING_REASON,
    });

    const retry = await handleInboundEmail(hung, null, JSON.stringify(hung), deps());
    expect(retry.kind).toBe("duplicate");

    const counted = await rowsOf("em_cupo_colgado");
    const total = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, USER));
    const limit = total.length;
    const other = event("em_cupo_otro");
    const out = await handleInboundEmail(other, null, JSON.stringify(other), {
      ...deps(),
      dailyLimit: limit,
    });
    expect(counted).toHaveLength(1);
    expect(out).toEqual({ kind: "rate_limited", userId: USER });
  });

  it("el intento se cuenta antes de clasificar: durante el procesamiento ya hay una fila provisional", async () => {
    const ev = event("em_cupo_durante");
    let duringProcessing: string | null = null;
    const storage = pgBlobStorage(conn.db);
    const realPut = storage.put.bind(storage);
    vi.spyOn(storage, "put").mockImplementationOnce(async (input) => {
      const [row] = await rowsOf("em_cupo_durante");
      duringProcessing = row?.error ?? null;
      return realPut(input);
    });

    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), { ...deps(), storage });

    expect(duringProcessing).toBe(PROCESSING_REASON);
    expect(out.kind).toBe("stored");
    const [final] = await rowsOf("em_cupo_durante");
    expect(final?.error).not.toBe(PROCESSING_REASON);
    expect(final?.rawRef).not.toBe("pending:");
  });
});
