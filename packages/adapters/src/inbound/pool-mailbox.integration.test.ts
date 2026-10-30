import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import {
  POOL_MANUAL_QUEUE_REASON,
  POOL_OVERSIZE_REASON,
  POOL_PARSER,
  POOL_QUEUE_MAX_PER_DAY,
  POOL_QUEUE_MAX_PER_HOUR,
  POOL_RAW_MAX_BYTES,
  type PoolInboundConfig,
} from "./pool-mailbox";
import type { ResendReceivedEvent } from "./resend";

/** ADR-024 (V8b): casillas pool-<carrera>@ detrás del interruptor. Remitente ficticio inyectado. */
const USER = "a0000000-0000-4000-8000-0000000000c1";
const DOMAIN = "ingest.test";
const PORTAL_FROM = "Alertas <avisos@portal-ficticio.test>";
const ON: PoolInboundConfig = {
  enabled: true,
  ingestDomain: DOMAIN,
  senderDomains: ["portal-ficticio.test"],
  careers: ["finanzas_contabilidad", "rrhh_it"],
};
const OFF: PoolInboundConfig = { ...ON, enabled: false };

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const event = (emailId: string, to: string, from: string): ResendReceivedEvent => ({
  type: "email.received",
  created_at: "2026-10-26T20:00:00.000Z",
  data: {
    email_id: emailId,
    from,
    to: [to],
    cc: [],
    bcc: [],
    received_for: [],
    subject: "Nuevas ofertas",
    attachments: [],
  },
});

const receive = (emailId: string, to: string, from: string, pool: PoolInboundConfig) => {
  const ev = event(emailId, to, from);
  return handleInboundEmail(
    ev,
    { html: "<p>cuerpo</p>", text: "cuerpo", headers: null },
    JSON.stringify(ev),
    {
      db: conn.db,
      storage: pgBlobStorage(conn.db),
      logger,
      pool,
    },
  );
};

const poolRows = async () =>
  conn.db.select().from(s.inboundEmails).where(isNull(s.inboundEmails.userId));
const blobCount = async () =>
  (
    (await conn.db.execute(sql`select count(*)::int as n from raw_blobs`)) as unknown as {
      n: number;
    }[]
  )[0]!.n;

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
      inboundAddress: `u_c1000000@${DOMAIN}`,
      profileSummary: "Contadora.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("casillas del pool (ADR-024)", () => {
  it("interruptor apagado: no se guarda nada y se responde como un destinatario desconocido", async () => {
    const before = await blobCount();
    const out = await receive("pool_off", `pool-rrhh_it@${DOMAIN}`, PORTAL_FROM, OFF);
    expect(out).toEqual({ kind: "unknown_recipient", recipientsCount: 1 });
    expect(await poolRows()).toHaveLength(0);
    expect(await blobCount()).toBe(before);
  });

  it("prendido y remitente del portal: cola manual del pool, sin extraer nada", async () => {
    const out = await receive("pool_on", `POOL-rrhh_it@${DOMAIN}`, PORTAL_FROM, ON);
    expect(out).toMatchObject({ kind: "pool_queued", career: "rrhh_it" });
    const rows = await poolRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: null,
      parser: POOL_PARSER,
      jobsExtracted: 0,
      error: POOL_MANUAL_QUEUE_REASON,
    });
    const blob = await pgBlobStorage(conn.db).get(rows[0]!.rawRef);
    expect(JSON.parse(blob!.body)).toMatchObject({ pool_career: "rrhh_it" });
    // El reintento de Svix es idempotente
    const again = await receive("pool_on", `pool-rrhh_it@${DOMAIN}`, PORTAL_FROM, ON);
    expect(again.kind).toBe("duplicate");
    expect(await poolRows()).toHaveLength(1);
  });

  it("prendido y otro remitente, carrera inexistente u otro dominio: se rechaza sin guardar", async () => {
    const before = await blobCount();
    const rows0 = (await poolRows()).length;
    for (const [id, to, from] of [
      ["pool_x1", `pool-rrhh_it@${DOMAIN}`, "Otro <jobs@example.com>"],
      ["pool_x2", `pool-astronauta@${DOMAIN}`, PORTAL_FROM],
      ["pool_x3", "pool-rrhh_it@otro.test", PORTAL_FROM],
    ] as const) {
      expect(await receive(id, to, from, ON)).toMatchObject({ kind: "unknown_recipient" });
    }
    expect(await poolRows()).toHaveLength(rows0);
    expect(await blobCount()).toBe(before);
  });

  it("si entre los destinatarios hay una u_… válida gana el flujo normal; el sobre decide primero", async () => {
    const pool = `pool-rrhh_it@${DOMAIN}`;
    const mine = `u_c1000000@${DOMAIN}`;
    const base = event("pool_mix1", pool, "Otro <jobs@example.com>");
    const send = (id: string, data: Partial<ResendReceivedEvent["data"]>) => {
      const ev = { ...base, data: { ...base.data, email_id: id, ...data } };
      return handleInboundEmail(ev, null, JSON.stringify(ev), {
        db: conn.db,
        storage: pgBlobStorage(conn.db),
        logger,
        pool: ON,
      });
    };
    // casilla del pool y u_… en to/cc, sin sobre: gana la persona
    expect(await send("pool_mix1", { to: [pool], cc: [mine] })).toMatchObject({
      kind: "stored",
      userId: USER,
    });
    // el sobre trae solo la u_…: gana la persona aunque `to` lleve la casilla del pool
    expect(await send("pool_mix2", { to: [pool], received_for: [mine] })).toMatchObject({
      kind: "stored",
      userId: USER,
    });
    // el sobre trae solo la casilla del pool: va al pool aunque una u_… vaya en copia
    expect(
      await send("pool_mix3", { to: [pool], cc: [mine], received_for: [pool], from: PORTAL_FROM }),
    ).toMatchObject({ kind: "pool_queued" });
  });

  it("crudo de más de 256 KB: se guardan solo los metadatos", async () => {
    const ev = event("pool_big", `pool-rrhh_it@${DOMAIN}`, PORTAL_FROM);
    const big = { html: "x".repeat(POOL_RAW_MAX_BYTES + 1), text: null, headers: null };
    const out = await handleInboundEmail(ev, big, JSON.stringify(ev), {
      db: conn.db,
      storage: pgBlobStorage(conn.db),
      logger,
      pool: ON,
    });
    expect(out.kind).toBe("pool_queued");
    if (out.kind !== "pool_queued") return;
    const [row] = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, out.inboundId));
    expect(row!.error).toBe(POOL_OVERSIZE_REASON);
    const blob = await pgBlobStorage(conn.db).get(row!.rawRef);
    expect(blob!.body.length).toBeLessThan(2000);
    expect(JSON.parse(blob!.body)).toMatchObject({ content: null, redacted: POOL_OVERSIZE_REASON });
  });

  it("tope de la cola: 30 por hora y 200 por día, rechazado sin guardar", async () => {
    const insertRows = async (n: number, ageHours: number) => {
      await conn.db.insert(s.inboundEmails).values(
        Array.from({ length: n }, () => ({
          userId: null,
          fromAddress: "a@example.com",
          rawRef: "pg:00000000-0000-4000-8000-000000000000",
          parser: POOL_PARSER,
          receivedAt: new Date(Date.now() - ageHours * 3_600_000),
        })),
      );
    };
    const clear = () =>
      conn.db
        .delete(s.inboundEmails)
        .where(
          and(
            isNull(s.inboundEmails.userId),
            eq(s.inboundEmails.rawRef, "pg:00000000-0000-4000-8000-000000000000"),
          ),
        );
    const attempt = (id: string) => receive(id, `pool-rrhh_it@${DOMAIN}`, PORTAL_FROM, ON);
    const total = async () => (await poolRows()).length;
    const t0 = await total();
    try {
      await insertRows(POOL_QUEUE_MAX_PER_HOUR, 0.1);
      expect(await attempt("pool_cap_h")).toMatchObject({ kind: "unknown_recipient" });
      expect(await total()).toBe(t0 + POOL_QUEUE_MAX_PER_HOUR);
      await clear();
      // 200 en el día pero ninguno en la última hora
      await insertRows(POOL_QUEUE_MAX_PER_DAY, 5);
      expect(await attempt("pool_cap_d")).toMatchObject({ kind: "unknown_recipient" });
      await clear();
      expect(await attempt("pool_cap_ok")).toMatchObject({ kind: "pool_queued" });
    } finally {
      await clear();
    }
  });

  it("una casilla u_… normal sigue igual, con el interruptor prendido o apagado", async () => {
    for (const [i, pool] of [OFF, ON].entries()) {
      const out = await receive(
        `pool_u${i}`,
        `u_c1000000@${DOMAIN}`,
        "Otro <jobs@example.com>",
        pool,
      );
      expect(out).toMatchObject({ kind: "stored", userId: USER });
    }
    const mine = await conn.db
      .select()
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.userId, USER));
    expect(mine.length).toBeGreaterThanOrEqual(2);
    expect(mine.every((m) => m.parser !== POOL_PARSER)).toBe(true);
  });
});
