import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { orphanSelectSql } from "../retention/purge";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail, STORAGE_FULL_REASON, userRawBytesSql } from "./handle";
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
      displayName: "Almacenamiento",
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

describe("tope de correo crudo por persona", () => {
  it("pasado el tope no guarda el crudo, deja la fila visible con su motivo y cuenta el rechazo", async () => {
    await conn.db.insert(s.rawBlobs).values({
      userId: USER,
      kind: "inbound_email",
      contentType: "application/json",
      body: "{}",
      bytes: 5_000,
    });
    const before = await blobCount();
    const rejectedBefore = await rejectedCount();
    const ev = event("em_alm_tope");

    const out = await handleInboundEmail(ev, null, JSON.stringify(ev), {
      ...deps(),
      maxBytesPerUser: 1_000,
    });

    expect(out.kind).toBe("stored");
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_alm_tope"));
    expect(row?.error).toBe(STORAGE_FULL_REASON);
    expect(row?.rawRef).toBe("none:");
    expect(await blobCount()).toBe(before);
    expect(await rejectedCount()).toBe(rejectedBefore + 1);
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
  it("no deja colgado el crudo propio si nadie lo referencia", async () => {
    const before = await blobCount();
    // El aviso final de «guardado» falla: la excepción llega al catch, después de guardar el crudo
    const failing = {
      child: () => failing,
      info: (_o: unknown, msg?: string) => {
        if (msg === "inbound: guardado") throw new Error("falla simulada");
      },
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    };
    const ev = event("em_alm_falla");

    await expect(
      handleInboundEmail(ev, null, JSON.stringify(ev), {
        ...deps(),
        logger: failing as unknown as typeof logger,
        maxBytesPerUser: 100 * 1024 * 1024,
      }),
    ).rejects.toThrow("falla simulada");

    expect(await blobCount()).toBe(before);
    const rows = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.emailId, "em_alm_falla"));
    expect(rows).toHaveLength(0);
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
