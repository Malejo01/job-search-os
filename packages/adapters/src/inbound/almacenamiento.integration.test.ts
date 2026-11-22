import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { orphanSelectSql } from "../retention/purge";
import { pgBlobStorage } from "../storage/blob";
import {
  handleInboundEmail,
  PENDING_RECLAIM_MS,
  STORAGE_FULL_REASON,
  userRawBytesSql,
} from "./handle";
import { linkedinParser } from "./linkedin";
import type { ResendReceivedEvent } from "./resend";

/** Tope de correo crudo por persona, limpieza del crudo propio y planes de consulta sin recorrer la tabla. */
const USER = "a0000000-0000-4000-8000-0000000000d4";
const OTHER = "a0000000-0000-4000-8000-0000000000d5";
const THIRD = "a0000000-0000-4000-8000-0000000000d6";
const ADDRESS = "u_d4000000@ingest.test";
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
      displayName: "Almacenamiento",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: ADDRESS,
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

const deps = () => ({ db: conn.db, storage: pgBlobStorage(conn.db), logger });
const blobCount = async () =>
  Number(
    (
      (await conn.db.execute(
        sql`SELECT count(*)::int AS n FROM raw_blobs WHERE user_id = ${USER}::uuid AND kind = 'inbound_email'`,
      )) as unknown as { n: number }[]
    )[0]?.n,
  );
const rejectedCount = async () =>
  Number(
    (
      (await conn.db.execute(
        sql`SELECT coalesce(sum(rejected), 0)::int AS n FROM inbound_rejections WHERE user_id = ${USER}::uuid`,
      )) as unknown as { n: number }[]
    )[0]?.n,
  );
const planOf = async (query: ReturnType<typeof sql>) => {
  const plan = (await conn.db.execute(sql`EXPLAIN ${query}`)) as unknown as Record<
    string,
    string
  >[];
  return plan.map((r) => Object.values(r)[0]).join("\n");
};

const realAlert = () => ({
  html: readFileSync(resolve(__dirname, "fixtures/linkedin/alerta-un-aviso.html"), "utf8"),
  text: null,
  headers: null,
});
const jobsOfUser = async () =>
  (await conn.db.select({ id: s.jobs.id }).from(s.jobs).where(eq(s.jobs.userId, USER))).length;

describe("tope de correo crudo por persona", () => {
  it("pasado el tope un email real de portal crea sus ofertas y solo deja de guardarse el crudo", async () => {
    await conn.db.insert(s.rawBlobs).values({
      userId: USER,
      kind: "inbound_email",
      contentType: "application/json",
      body: "{}",
      bytes: 5_000,
    });
    const before = await blobCount();
    const jobsBefore = await jobsOfUser();
    const rejectedBefore = await rejectedCount();
    const ev = event("em_alm_tope");

    const out = await handleInboundEmail(ev, realAlert(), JSON.stringify(ev), {
      ...deps(),
      maxBytesPerUser: 1_000,
    });

    expect(out.kind).toBe("stored");
    if (out.kind !== "stored") return;
    expect(out.jobsExtracted).toBeGreaterThan(0);
    expect(await jobsOfUser()).toBeGreaterThan(jobsBefore);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_alm_tope"));
    expect(row?.error).toBe(STORAGE_FULL_REASON);
    expect(row?.rawRef).toBe("none:");
    expect(await blobCount()).toBe(before);
    expect(await rejectedCount()).toBe(rejectedBefore + 1);
    // Las ofertas no apuntan a un crudo que no existe
    const sources = await conn.db
      .select({ rawRef: s.jobSources.rawRef })
      .from(s.jobSources)
      .innerJoin(s.jobs, eq(s.jobs.id, s.jobSources.jobId))
      .where(eq(s.jobs.userId, USER));
    expect(sources.every((r) => r.rawRef === null || r.rawRef.startsWith("pg:"))).toBe(true);
  });

  it("con espacio disponible guarda el crudo como siempre", async () => {
    const before = await blobCount();
    const ev = event("em_alm_libre");

    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), {
      ...deps(),
      maxBytesPerUser: 100 * 1024 * 1024,
    });

    expect(out.kind).toBe("stored");
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_alm_libre"));
    expect(row?.rawRef).toMatch(/^pg:/);
    expect(row?.error).not.toBe(STORAGE_FULL_REASON);
    expect(await blobCount()).toBe(before + 1);
  });
});

describe("entrega fallida", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no deja colgado el crudo propio y deja la fila retomable; el reintento la procesa sin contar doble", async () => {
    const before = await blobCount();
    const totalBefore = (
      await conn.db
        .select({ id: s.inboundEmails.id })
        .from(s.inboundEmails)
        .where(eq(s.inboundEmails.userId, USER))
    ).length;
    // El parser lanza y el aviso de esa falla también: la excepción llega al catch después de guardar el crudo
    vi.spyOn(linkedinParser, "parse").mockImplementationOnce(() => {
      throw new Error("falla simulada");
    });
    const failing = {
      child: () => failing,
      info: () => undefined,
      warn: (_o: unknown, msg?: string) => {
        if (msg?.includes("el parser lanzó")) throw new Error("falla de la entrega");
      },
      error: () => undefined,
      debug: () => undefined,
    };
    const ev = event("em_alm_falla");

    await expect(
      handleInboundEmail(ev, realAlert(), JSON.stringify(ev), {
        ...deps(),
        logger: failing as unknown as typeof logger,
        maxBytesPerUser: 100 * 1024 * 1024,
      }),
    ).rejects.toThrow("falla de la entrega");

    // El crudo propio se borró; la fila sigue provisional y ya vencida para que el reintento la tome
    expect(await blobCount()).toBe(before);
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_alm_falla"));
    expect(row?.rawRef).toBe("pending:");
    expect(Date.now() - row!.receivedAt.getTime()).toBeGreaterThan(PENDING_RECLAIM_MS);

    const retry = await handleInboundEmail(ev, realAlert(), JSON.stringify(ev), {
      ...deps(),
      maxBytesPerUser: 100 * 1024 * 1024,
    });

    expect(retry.kind).toBe("stored");
    const rows = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, USER));
    // Una sola fila por email_id: el reintento retomó la provisional, no sumó otro intento al cupo
    expect(rows.filter((r) => r.emailId === "em_alm_falla")).toHaveLength(1);
    expect(rows).toHaveLength(totalBefore + 1);
    expect(rows.find((r) => r.emailId === "em_alm_falla")?.rawRef).toMatch(/^pg:/);
  });
});

describe("planes sin Seq Scan con miles de filas", () => {
  it("la suma de bytes por persona usa el índice de raw_blobs", async () => {
    await conn.db.execute(sql`
      INSERT INTO raw_blobs (user_id, kind, content_type, body, bytes)
      SELECT gen_random_uuid(), 'inbound_email', 'application/json', '{}', 2
      FROM generate_series(1, 6000)
    `);
    await conn.db.execute(sql`ANALYZE raw_blobs`);

    const text = await planOf(userRawBytesSql(USER));

    expect(text).not.toMatch(/Seq Scan on raw_blobs/);
  });

  it("el anti-join de huérfanos usa los índices por raw_ref de inbound_emails y job_sources", async () => {
    // Tablas grandes de emails y ofertas (ya con su historia) y unos cientos de crudos candidatos recientes:
    // con pocos candidatos el cruce va por el índice de raw_ref; con todo el historial como candidato, una
    // pasada completa con hash sería el plan correcto, y por eso la purga acota la ventana.
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser)
      SELECT ${OTHER}::uuid, 'x@example.com', 'pg:' || gen_random_uuid()::text, 'linkedin'
      FROM generate_series(1, 150000)
    `);
    await conn.db.execute(sql`
      INSERT INTO raw_blobs (user_id, kind, content_type, body, bytes, created_at)
      SELECT ${OTHER}::uuid, 'inbound_email', 'application/json', '{}', 2, now() - interval '10 days'
      FROM generate_series(1, 300)
    `);
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser)
      SELECT ${OTHER}::uuid, 'x@example.com', 'pg:' || id::text, 'linkedin'
      FROM (SELECT id FROM raw_blobs WHERE user_id = ${OTHER}::uuid ORDER BY id LIMIT 100) b
    `);
    const [job] = await conn.db
      .insert(s.jobs)
      .values({
        userId: OTHER,
        companyRaw: "Empresa A",
        title: "Backend Engineer",
        titleNormalized: "backend engineer",
      })
      .returning({ id: s.jobs.id });
    await conn.db.execute(sql`
      INSERT INTO job_sources (job_id, kind, raw_ref)
      SELECT ${job!.id}::uuid, 'email_linkedin', 'pg:' || id::text
      FROM (SELECT id FROM raw_blobs WHERE user_id = ${OTHER}::uuid ORDER BY id DESC LIMIT 100) b
    `);
    await conn.db.execute(sql`
      INSERT INTO job_sources (job_id, kind, raw_ref)
      SELECT ${job!.id}::uuid, 'email_linkedin', 'pg:' || gen_random_uuid()::text
      FROM generate_series(1, 100000)
    `);
    await conn.db.execute(sql`ANALYZE raw_blobs`);
    await conn.db.execute(sql`ANALYZE inbound_emails`);
    await conn.db.execute(sql`ANALYZE job_sources`);

    const now = Date.now();
    const text = await planOf(
      orphanSelectSql(new Date(now - 86_400_000), 5_000, new Date(now - 31 * 86_400_000)),
    );

    expect(text).not.toMatch(/Seq Scan on inbound_emails/);
    expect(text).not.toMatch(/Seq Scan on job_sources/);
  });

  it("el conteo con ventana de 30 días usa el índice de la bandeja", async () => {
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser, received_at)
      SELECT gen_random_uuid(), 'x@example.com', 'pg:x', 'linkedin', now() - (g || ' hours')::interval
      FROM generate_series(1, 6000) g
    `);
    await conn.db.execute(sql`
      INSERT INTO inbound_emails (user_id, from_address, raw_ref, parser, received_at)
      SELECT ${THIRD}::uuid, 'x@example.com', 'pg:x', 'linkedin', now() - (g || ' days')::interval
      FROM generate_series(1, 90) g
    `);
    await conn.db.execute(sql`ANALYZE inbound_emails`);

    // Misma forma que los conteos de /inbox y filterLeaks: RLS agrega el filtro por user_id
    const text = await planOf(sql`
      SELECT count(*)::int, count(*) FILTER (WHERE seen_at IS NULL)::int
      FROM inbound_emails
      WHERE user_id = ${THIRD}::uuid AND received_at >= now() - interval '30 days'
    `);

    expect(text).not.toMatch(/Seq Scan on inbound_emails/);
  });
});
