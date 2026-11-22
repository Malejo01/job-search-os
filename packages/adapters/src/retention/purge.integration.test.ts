import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { POOL_PARSER } from "../inbound/pool-mailbox";
import { orphanSelectSql, PURGE_MAX_BATCHES, parseLogDays, purgeExpired } from "./purge";

/** JS-107 · la purga borra solo lo vencido, respeta la ventana del tope y la cola viva. */
const A = "a0000000-0000-4000-8000-000000000107";
const B = "b0000000-0000-4000-8000-000000000107";
const NOW = new Date("2026-06-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
const TAG = "purge-107";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function seed() {
  const { db } = conn;
  await db.delete(s.passwordResetTokens).where(inArray(s.passwordResetTokens.userId, [A, B]));
  await db.delete(s.llmCalls).where(inArray(s.llmCalls.userId, [A, B]));
  await db.delete(s.jobQueue).where(inArray(s.jobQueue.userId, [A, B]));
  await db.delete(s.inboundRejections).where(inArray(s.inboundRejections.userId, [A, B]));

  for (const [u, k] of [
    [A, "a"],
    [B, "b"],
  ] as const) {
    await db.insert(s.passwordResetTokens).values([
      { userId: u, tokenHash: `${TAG}-${k}-vencido`, expiresAt: daysAgo(3) },
      { userId: u, tokenHash: `${TAG}-${k}-usado`, expiresAt: daysAgo(-1), usedAt: daysAgo(2) },
      { userId: u, tokenHash: `${TAG}-${k}-vigente`, expiresAt: daysAgo(-1) },
      {
        userId: u,
        tokenHash: `${TAG}-${k}-usado-hoy`,
        expiresAt: daysAgo(-1),
        usedAt: hoursAgo(1),
      },
    ]);
    const call = { userId: u, task: TAG, model: "m", ok: true };
    await db.insert(s.llmCalls).values([
      { ...call, createdAt: daysAgo(100) },
      { ...call, createdAt: daysAgo(40) },
      { ...call, createdAt: daysAgo(20) },
      { ...call, createdAt: hoursAgo(23) }, // dentro de la ventana del tope
    ]);
    const job = { userId: u, queue: TAG, payload: {} };
    await db.insert(s.jobQueue).values([
      { ...job, status: "done", updatedAt: daysAgo(40) },
      { ...job, status: "failed", updatedAt: daysAgo(40) },
      { ...job, status: "done", updatedAt: daysAgo(1) },
      { ...job, status: "pending", createdAt: daysAgo(90), updatedAt: daysAgo(90) },
      { ...job, status: "processing", createdAt: daysAgo(90), updatedAt: daysAgo(90) },
    ]);
    await db.insert(s.inboundRejections).values([
      { userId: u, windowStart: daysAgo(40) },
      { userId: u, windowStart: daysAgo(1.5) },
      { userId: u, windowStart: daysAgo(1) },
    ]);
  }
}

const mine = [A, B];
const count = async () => ({
  tokens: (
    await conn.db
      .select()
      .from(s.passwordResetTokens)
      .where(inArray(s.passwordResetTokens.userId, mine))
  ).length,
  llmCalls: (await conn.db.select().from(s.llmCalls).where(inArray(s.llmCalls.userId, mine)))
    .length,
  queue: (await conn.db.select().from(s.jobQueue).where(inArray(s.jobQueue.userId, mine))).length,
  rejections: (
    await conn.db
      .select()
      .from(s.inboundRejections)
      .where(inArray(s.inboundRejections.userId, mine))
  ).length,
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
    .insert(s.users)
    .values([
      { id: A, email: "a107@usuario.test", passwordHash: "x" },
      { id: B, email: "b107@usuario.test", passwordHash: "x" },
    ])
    .onConflictDoNothing();
}, 180_000);

beforeEach(seed);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("purgeExpired", () => {
  it("con logDays borra solo lo vencido, de los dos usuarios", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    // tokens: queda vigente y usado hoy; llm: solo cae lo de más de 90 d; cola: done reciente,
    // pending, processing; rechazos: los de 1 y 1,5 d
    expect(await count()).toEqual({ tokens: 4, llmCalls: 6, queue: 6, rejections: 4 });
  });

  it("llm_calls tiene mínimo de 90 días aunque logDays sea 1", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.llmCalls).where(inArray(s.llmCalls.userId, mine));
    // solo se va lo de 100 d; las de 40 d, 20 d y 23 h (ventana del tope) se quedan
    expect(left).toHaveLength(6);
    expect(left.every((r) => r.createdAt >= daysAgo(90))).toBe(true);
  });

  it("borde de los 90 días en llm_calls: 89 d queda y 91 d cae, con logDays en 1", async () => {
    const edge = { userId: A, task: `${TAG}-borde`, model: "m", ok: false, error: "api_call:500" };
    await conn.db.insert(s.llmCalls).values([
      { ...edge, createdAt: daysAgo(89) },
      { ...edge, createdAt: daysAgo(91) },
    ]);
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.llmCalls).where(eq(s.llmCalls.task, edge.task));
    expect(left.map((r) => r.createdAt.getTime())).toEqual([daysAgo(89).getTime()]);
  });

  it("con logDays mayor que el mínimo, llm_calls usa logDays", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 120 });
    expect((await count()).llmCalls).toBe(8);
  });

  it("inbound_rejections tiene su mínimo aunque logDays sea 1", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db
      .select()
      .from(s.inboundRejections)
      .where(inArray(s.inboundRejections.userId, mine));
    expect(left).toHaveLength(4);
    expect(left.every((r) => r.windowStart >= daysAgo(2))).toBe(true);
  });

  it("corta en 10 lotes por tabla y deja el resto para la próxima corrida", async () => {
    // tokens vencidos de mis dos usuarios: 4 con lote de 1 se borran de a 1 hasta el tope
    const first = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(first.tokens).toBeLessThanOrEqual(PURGE_MAX_BATCHES);
    const seedMore = Array.from({ length: 12 }, (_, i) => ({
      userId: A,
      tokenHash: `${TAG}-extra-${i}`,
      expiresAt: daysAgo(5),
    }));
    await conn.db.insert(s.passwordResetTokens).values(seedMore);
    const second = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(second.tokens).toBe(PURGE_MAX_BATCHES);
    // la próxima corrida termina lo que quedó (otros tests de la base compartida pueden sumar filas)
    const third = await purgeExpired(conn.db, { now: NOW, batchSize: 1 });
    expect(third.tokens).toBeGreaterThanOrEqual(2);
    const left = await conn.db
      .select()
      .from(s.passwordResetTokens)
      .where(inArray(s.passwordResetTokens.userId, mine));
    expect(left.some((r) => r.tokenHash.startsWith(`${TAG}-extra-`))).toBe(false);
  });

  it("pone en null el ip_hash de la lista de espera de más de 24 h, sin borrar la fila", async () => {
    const base = { name: "Persona", role: "frontend" };
    await conn.db.delete(s.waitlist).where(eq(s.waitlist.name, "Persona purga"));
    await conn.db.insert(s.waitlist).values([
      {
        ...base,
        name: "Persona purga",
        email: `vieja@${TAG}.test`,
        ipHash: "h1",
        createdAt: hoursAgo(25),
      },
      {
        ...base,
        name: "Persona purga",
        email: `nueva@${TAG}.test`,
        ipHash: "h2",
        createdAt: hoursAgo(2),
      },
    ]);
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r.waitlistIps).toBeGreaterThanOrEqual(1);
    const rows = await conn.db
      .select()
      .from(s.waitlist)
      .where(eq(s.waitlist.name, "Persona purga"));
    const byEmail = Object.fromEntries(rows.map((x) => [x.email, x.ipHash]));
    expect(byEmail[`vieja@${TAG}.test`]).toBeNull();
    expect(byEmail[`nueva@${TAG}.test`]).toBe("h2");
    await conn.db.delete(s.waitlist).where(eq(s.waitlist.name, "Persona purga"));
  });

  it("no toca la cola pendiente ni en curso por vieja que sea", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const left = await conn.db.select().from(s.jobQueue).where(inArray(s.jobQueue.userId, mine));
    expect(left.map((r) => r.status).sort()).toEqual([
      "done",
      "done",
      "pending",
      "pending",
      "processing",
      "processing",
    ]);
  });

  it("sin logDays solo borra los tokens", async () => {
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r).toMatchObject({ llmCalls: 0, queue: 0, rejections: 0 });
    expect(r.tokens).toBeGreaterThanOrEqual(4);
    expect(await count()).toEqual({ tokens: 4, llmCalls: 8, queue: 10, rejections: 6 });
  });

  it("logDays fuera de rango se trata como ausente", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 0 });
    await purgeExpired(conn.db, { now: NOW, logDays: 99_999 });
    expect(await count()).toEqual({ tokens: 4, llmCalls: 8, queue: 10, rejections: 6 });
  });

  it("es idempotente", async () => {
    await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    const second = await purgeExpired(conn.db, { now: NOW, logDays: 30 });
    expect(second).toEqual({
      tokens: 0,
      llmCalls: 0,
      queue: 0,
      rejections: 0,
      waitlistIps: 0,
      invitations: 0,
      invitationEmails: 0,
      betaFeedback: 0,
      poolEmails: 0,
      inboundRaw: 0,
      inboundOrphans: 0,
      loginAttempts: 0,
      stalePending: 0,
    });
  });

  describe("intentos de login", () => {
    const OLD = "e".repeat(64);
    const FRESH = "f".repeat(64);
    const rows = async () =>
      (
        (await conn.db.execute(
          sql`select email_hash from login_attempts where email_hash in (${OLD}, ${FRESH})`,
        )) as unknown as { email_hash: string }[]
      ).map((r) => r.email_hash);

    beforeEach(async () => {
      await conn.db.execute(sql`delete from login_attempts where email_hash in (${OLD}, ${FRESH})`);
      await conn.db.execute(sql`insert into login_attempts (email_hash, last_attempt_at)
        values (${OLD}, ${daysAgo(2).toISOString()}::timestamptz),
               (${FRESH}, ${hoursAgo(12).toISOString()}::timestamptz)`);
    });

    afterAll(async () => {
      await conn.db.execute(sql`delete from login_attempts where email_hash in (${OLD}, ${FRESH})`);
    });

    it("la corrida borra las filas con más de un día sin actividad y deja las vigentes", async () => {
      const result = await purgeExpired(conn.db, { now: NOW });

      expect(result.loginAttempts).toBeGreaterThanOrEqual(1);
      expect(await rows()).toEqual([FRESH]);
    });

    it("corre aunque la purga técnica (LEGAL_LOG_DAYS) esté desactivada", async () => {
      await purgeExpired(conn.db, { now: NOW, logDays: 0 });

      expect(await rows()).toEqual([FRESH]);
    });
  });

  describe("crudos de emails de personas", () => {
    beforeEach(async () => {
      await conn.db.delete(s.inboundEmails).where(eq(s.inboundEmails.userId, A));
      await conn.db.delete(s.rawBlobs).where(eq(s.rawBlobs.userId, A));
    });

    // Por defecto el email ya está resuelto (visto): lo pendiente en /inbox no se purga
    const mkEmail = async (
      age: number,
      kind = "inbound_email",
      row: Partial<typeof s.inboundEmails.$inferInsert> = {},
    ) => {
      const [blob] = await conn.db
        .insert(s.rawBlobs)
        .values({ userId: A, kind, contentType: "application/json", body: "{}", bytes: 2 })
        .returning({ id: s.rawBlobs.id });
      const rawRef = `pg:${blob!.id}`;
      const [email] = await conn.db
        .insert(s.inboundEmails)
        .values({
          userId: A,
          fromAddress: "a@example.com",
          rawRef,
          parser: "none",
          receivedAt: daysAgo(age),
          seenAt: daysAgo(age),
          ...row,
        })
        .returning({ id: s.inboundEmails.id });
      return { blob: blob!.id, email: email!.id, rawRef };
    };
    const mkOrphan = async (age: number, kind = "inbound_email") => {
      const [blob] = await conn.db
        .insert(s.rawBlobs)
        .values({
          userId: A,
          kind,
          contentType: "application/json",
          body: "{}",
          bytes: 2,
          createdAt: daysAgo(age),
        })
        .returning({ id: s.rawBlobs.id });
      return { blob: blob!.id, rawRef: `pg:${blob!.id}` };
    };
    const blobExists = async (id: string) =>
      (await conn.db.select({ id: s.rawBlobs.id }).from(s.rawBlobs).where(eq(s.rawBlobs.id, id)))
        .length === 1;

    it("sin la variable no borra ningún crudo", async () => {
      const old = await mkEmail(400);

      const r = await purgeExpired(conn.db, { now: NOW });

      expect(r.inboundRaw).toBe(0);
      expect(await blobExists(old.blob)).toBe(true);
    });

    it("borra el crudo viejo sin oferta, conserva la fila y respeta el resto", async () => {
      const old = await mkEmail(100);
      const fresh = await mkEmail(10);
      const otherKind = await mkEmail(100, "jd_pegada");
      const withJob = await mkEmail(100);
      const [job] = await conn.db
        .insert(s.jobs)
        .values({
          userId: A,
          companyRaw: "Empresa A",
          title: "Backend Engineer",
          titleNormalized: "backend engineer",
        })
        .returning({ id: s.jobs.id });
      await conn.db
        .insert(s.jobSources)
        .values({ jobId: job!.id, kind: "email_linkedin", rawRef: withJob.rawRef });

      const r = await purgeExpired(conn.db, { now: NOW, inboundRawDays: 90 });

      expect(r.inboundRaw).toBe(1);
      expect(await blobExists(old.blob)).toBe(false);
      expect(await blobExists(fresh.blob)).toBe(true);
      expect(await blobExists(otherKind.blob)).toBe(true);
      expect(await blobExists(withJob.blob)).toBe(true);
      const emails = await conn.db
        .select({ id: s.inboundEmails.id })
        .from(s.inboundEmails)
        .where(eq(s.inboundEmails.id, old.email));
      expect(emails).toHaveLength(1);
    });

    it("un email pendiente conserva su crudo hasta 90 días, también el retenido y la confirmación de Gmail", async () => {
      const sinParser = await mkEmail(60, "inbound_email", { seenAt: null, parser: "none" });
      const conError = await mkEmail(60, "inbound_email", {
        seenAt: null,
        parser: "linkedin",
        error: "estructura no reconocida",
      });
      const retenido = await mkEmail(60, "inbound_email", {
        seenAt: null,
        parser: "linkedin",
        error: "remitente sin autenticación verificada: cola manual",
      });
      const gmail = await mkEmail(60, "inbound_email", {
        seenAt: null,
        parser: "gmail_reenvio",
        error: null,
      });
      const visto = await mkEmail(60, "inbound_email", { parser: "linkedin" });
      const descartado = await mkEmail(60, "inbound_email", {
        seenAt: null,
        dismissedAt: daysAgo(50),
      });

      const r = await purgeExpired(conn.db, { now: NOW, inboundRawDays: 30 });

      expect(r.inboundRaw).toBe(2);
      for (const kept of [sinParser, conError, retenido, gmail]) {
        expect(await blobExists(kept.blob)).toBe(true);
      }
      expect(await blobExists(visto.blob)).toBe(false);
      expect(await blobExists(descartado.blob)).toBe(false);
    });

    it("un pendiente de más de 90 días se purga, la fila queda y la bandeja lo muestra como vencido", async () => {
      const viejo = await mkEmail(100, "inbound_email", {
        seenAt: null,
        parser: "linkedin",
        error: "estructura no reconocida",
      });

      const r = await purgeExpired(conn.db, { now: NOW, inboundRawDays: 30 });

      expect(r.inboundRaw).toBe(1);
      expect(await blobExists(viejo.blob)).toBe(false);
      // La fila sigue con su `pg:` apuntando a un crudo que ya no existe: es lo que /inbox llama «venció»
      const [fila] = await conn.db
        .select({ rawRef: s.inboundEmails.rawRef })
        .from(s.inboundEmails)
        .where(eq(s.inboundEmails.id, viejo.email));
      expect(fila?.rawRef).toBe(viejo.rawRef);
    });

    it("una fila provisional en proceso no pierde nada", async () => {
      const provisional = await mkEmail(100, "inbound_email", {
        seenAt: null,
        rawRef: "pending:",
        error: "procesando: el email no terminó de procesarse",
      });
      const r = await purgeExpired(conn.db, { now: NOW, inboundRawDays: 90 });
      expect(r.inboundRaw).toBe(0);
      expect(await blobExists(provisional.blob)).toBe(true);
    });

    it("un crudo huérfano vencido se borra; uno usado por una oferta, uno reciente y otro tipo no", async () => {
      const huerfano = await mkOrphan(100);
      const reciente = await mkOrphan(10);
      const otroTipo = await mkOrphan(100, "jd_pegada");
      const conOferta = await mkOrphan(100);
      const referenciado = await mkEmail(10);
      const [job] = await conn.db
        .insert(s.jobs)
        .values({
          userId: A,
          companyRaw: "Empresa A",
          title: "Backend Engineer",
          titleNormalized: "backend engineer",
        })
        .returning({ id: s.jobs.id });
      await conn.db
        .insert(s.jobSources)
        .values({ jobId: job!.id, kind: "email_linkedin", rawRef: conOferta.rawRef });

      const r = await purgeExpired(conn.db, { now: NOW, inboundRawDays: 90 });

      expect(r.inboundOrphans).toBe(1);
      expect(await blobExists(huerfano.blob)).toBe(false);
      expect(await blobExists(reciente.blob)).toBe(true);
      expect(await blobExists(otroTipo.blob)).toBe(true);
      expect(await blobExists(conOferta.blob)).toBe(true);
      expect(await blobExists(referenciado.blob)).toBe(true);
    });

    it("sin la variable borra los huérfanos de más de un día y respeta ofertas y recientes", async () => {
      const huerfano = await mkOrphan(2);
      const reciente = await mkOrphan(0.5);
      const conOferta = await mkOrphan(400);
      const [job] = await conn.db
        .insert(s.jobs)
        .values({
          userId: A,
          companyRaw: "Empresa A",
          title: "Backend Engineer",
          titleNormalized: "backend engineer",
        })
        .returning({ id: s.jobs.id });
      await conn.db
        .insert(s.jobSources)
        .values({ jobId: job!.id, kind: "email_linkedin", rawRef: conOferta.rawRef });

      const r = await purgeExpired(conn.db, { now: NOW });

      expect(r.inboundOrphans).toBe(1);
      expect(await blobExists(huerfano.blob)).toBe(false);
      expect(await blobExists(reciente.blob)).toBe(true);
      expect(await blobExists(conOferta.blob)).toBe(true);
    });

    it("la purga de huérfanos usa índice sobre raw_blobs con miles de filas", async () => {
      await conn.db.execute(sql`
        INSERT INTO raw_blobs (user_id, kind, content_type, body, bytes, created_at)
        SELECT ${A}::uuid, 'inbound_email', 'application/json', '{}', 2, ${daysAgo(1).toISOString()}::timestamptz
        FROM generate_series(1, 6000)
      `);
      await mkOrphan(100);
      await conn.db.execute(sql`ANALYZE raw_blobs`);

      const plan = (await conn.db.execute(
        sql`EXPLAIN ${orphanSelectSql(daysAgo(90), 5_000)}`,
      )) as unknown as Record<string, string>[];
      const text = plan.map((r) => Object.values(r)[0]).join("\n");

      expect(text).not.toMatch(/Seq Scan on raw_blobs/);
    });
  });

  it("purga la cola del pool a los 30 días con su crudo y no toca emails de personas", async () => {
    const mk = async (userId: string | null, parser: string, age: number) => {
      const [blob] = await conn.db
        .insert(s.rawBlobs)
        .values({ userId, kind: TAG, contentType: "text/plain", body: "x", bytes: 1 })
        .returning({ id: s.rawBlobs.id });
      const [row] = await conn.db
        .insert(s.inboundEmails)
        .values({
          userId,
          fromAddress: "a@example.com",
          rawRef: `pg:${blob!.id}`,
          parser,
          receivedAt: daysAgo(age),
        })
        .returning({ id: s.inboundEmails.id });
      return { blob: blob!.id, email: row!.id };
    };
    const oldPool = await mk(null, POOL_PARSER, 31);
    const freshPool = await mk(null, POOL_PARSER, 29);
    const oldOther = await mk(null, "none", 60);
    const oldPerson = await mk(A, POOL_PARSER, 60);
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r.poolEmails).toBe(1);
    const emails = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(
        inArray(s.inboundEmails.id, [
          oldPool.email,
          freshPool.email,
          oldOther.email,
          oldPerson.email,
        ]),
      );
    expect(emails.map((e) => e.id).sort()).toEqual(
      [freshPool.email, oldOther.email, oldPerson.email].sort(),
    );
    const blobs = await conn.db
      .select({ id: s.rawBlobs.id })
      .from(s.rawBlobs)
      .where(inArray(s.rawBlobs.id, [oldPool.blob, freshPool.blob, oldOther.blob, oldPerson.blob]));
    expect(blobs.map((b) => b.id).sort()).toEqual(
      [freshPool.blob, oldOther.blob, oldPerson.blob].sort(),
    );
  });

  it("borra los comentarios de la beta de más de 180 días y deja los demás", async () => {
    const row = { userId: A, category: "idea", message: "Mensaje ficticio", path: "/hoy" };
    await conn.db.delete(s.betaFeedback).where(eq(s.betaFeedback.userId, A));
    await conn.db.insert(s.betaFeedback).values([
      { ...row, createdAt: daysAgo(181) },
      { ...row, createdAt: daysAgo(179) },
      { ...row, createdAt: daysAgo(1) },
    ]);
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r.betaFeedback).toBe(1);
    const left = await conn.db.select().from(s.betaFeedback).where(eq(s.betaFeedback.userId, A));
    expect(left).toHaveLength(2);
    await conn.db.delete(s.betaFeedback).where(eq(s.betaFeedback.userId, A));
  });

  it("borra la invitación vencida sin usar, respeta la gracia y anula el email de la usada", async () => {
    const base = { createdByUserId: A };
    await conn.db.delete(s.invitations).where(eq(s.invitations.createdByUserId, A));
    await conn.db.insert(s.invitations).values([
      {
        ...base,
        codeHash: `${TAG}-inv-vencida`,
        expiresAt: daysAgo(8),
        email: "persona@example.com",
      },
      { ...base, codeHash: `${TAG}-inv-en-gracia`, expiresAt: daysAgo(3) },
      {
        ...base,
        codeHash: `${TAG}-inv-vigente`,
        expiresAt: daysAgo(-5),
        email: "persona@example.com",
      },
      {
        ...base,
        codeHash: `${TAG}-inv-usada`,
        expiresAt: daysAgo(-5),
        usedAt: daysAgo(1),
        email: "persona@example.com",
      },
    ]);
    const r = await purgeExpired(conn.db, { now: NOW });
    expect(r.invitations).toBe(1);
    expect(r.invitationEmails).toBe(1);
    const left = await conn.db
      .select()
      .from(s.invitations)
      .where(eq(s.invitations.createdByUserId, A));
    const byHash = Object.fromEntries(left.map((i) => [i.codeHash, i]));
    expect(byHash[`${TAG}-inv-vencida`]).toBeUndefined();
    expect(byHash[`${TAG}-inv-en-gracia`]).toBeDefined();
    expect(byHash[`${TAG}-inv-vigente`]?.email).toBe("persona@example.com");
    expect(byHash[`${TAG}-inv-usada`]?.email).toBeNull();
    expect(byHash[`${TAG}-inv-usada`]?.usedAt).not.toBeNull();
  });

  it("no toca raw_blobs ni inbound_emails", async () => {
    const [blob] = await conn.db
      .insert(s.rawBlobs)
      .values({
        userId: A,
        kind: TAG,
        contentType: "text/plain",
        body: "x",
        bytes: 1,
        createdAt: daysAgo(500),
      })
      .returning({ id: s.rawBlobs.id });
    await purgeExpired(conn.db, { now: NOW, logDays: 1 });
    const rows = await conn.db
      .select()
      .from(s.rawBlobs)
      .where(inArray(s.rawBlobs.id, [blob!.id]));
    expect(rows).toHaveLength(1);
  });
});

describe("parseLogDays", () => {
  it("acepta enteros de 1 a 3650 y rechaza el resto", () => {
    expect(parseLogDays("30")).toBe(30);
    expect(parseLogDays("3650")).toBe(3650);
    for (const bad of [undefined, "", "0", "3651", "-5", "abc", "1.5", "30 días"]) {
      expect(parseLogDays(bad)).toBeNull();
    }
  });
});
