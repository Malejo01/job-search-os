import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, isNull, sql } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgBlobStorage } from "../storage/blob";
import { handleInboundEmail } from "./handle";
import { POOL_PARSER, POOL_READER_FAILED_PREFIX, type PoolInboundConfig } from "./pool-mailbox";
import type { ResendReceivedEvent } from "./resend";

/**
 * R19-01 (ADR-043): el lector de las casillas pool-<carrera>@ detrás de POOL_COMPUTRABAJO_READER.
 * Remitente y avisos ficticios. Apagado, todo va a la cola manual; prendido, los avisos entran a public_jobs.
 */
const DOMAIN = "ingest.test";
const FROM = "Alertas <avisos@portal-ficticio.test>";
const ID_UNA = "0A1B2C3D4E5F60718293A4B5C6D7E8F1";
const BASE: PoolInboundConfig = {
  enabled: true,
  ingestDomain: DOMAIN,
  senderDomains: ["portal-ficticio.test"],
  careers: ["finanzas_contabilidad", "rrhh_it"],
};
const READER_OFF: PoolInboundConfig = { ...BASE, computrabajoReader: false };
const READER_ON: PoolInboundConfig = { ...BASE, computrabajoReader: true };

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "fixtures/computrabajo", name), "utf8");

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const receive = (emailId: string, career: string, html: string, pool: PoolInboundConfig) => {
  const ev: ResendReceivedEvent = {
    type: "email.received",
    created_at: "2026-11-22T20:00:00.000Z",
    data: {
      email_id: emailId,
      from: FROM,
      to: [`pool-${career}@${DOMAIN}`],
      cc: [],
      bcc: [],
      received_for: [],
      subject: "Nuevos empleos",
      attachments: [],
    },
  };
  return handleInboundEmail(ev, { html, text: null, headers: null }, JSON.stringify(ev), {
    db: conn.db,
    storage: pgBlobStorage(conn.db),
    logger,
    pool,
  });
};

const poolJobs = () =>
  conn.db.select().from(s.publicJobs).where(eq(s.publicJobs.sourceKind, "computrabajo_alerts"));
const emailRow = async (id: string) =>
  (await conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.id, id)))[0]!;

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
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("lector del pool: interruptor apagado", () => {
  it("el email de estructura conocida va a la cola manual y no entra nada a public_jobs", async () => {
    const out = await receive(
      "lector_off",
      "rrhh_it",
      fixture("pool-alerta-una-tarjeta.html"),
      READER_OFF,
    );
    expect(out).toMatchObject({ kind: "pool_queued", career: "rrhh_it" });
    if (out.kind !== "pool_queued") return;
    const row = await emailRow(out.inboundId);
    expect(row).toMatchObject({ userId: null, parser: POOL_PARSER, jobsExtracted: 0 });
    expect(row.error).toMatch(/sin lector validado/);
    expect(await poolJobs()).toHaveLength(0);
  });

  it("sin el campo del interruptor (config anterior) también queda apagado", async () => {
    const out = await receive(
      "lector_ausente",
      "rrhh_it",
      fixture("pool-alerta-una-tarjeta.html"),
      BASE,
    );
    expect(out.kind).toBe("pool_queued");
    expect(await poolJobs()).toHaveLength(0);
  });
});

describe("lector del pool: interruptor prendido", () => {
  it("cada aviso entra a public_jobs con la carrera de la casilla, sin países y sin rastro del tracker", async () => {
    const out = await receive(
      "lector_on_1",
      "finanzas_contabilidad",
      fixture("pool-alerta-una-tarjeta.html"),
      READER_ON,
    );
    expect(out).toMatchObject({
      kind: "pool_read",
      career: "finanzas_contabilidad",
      jobsExtracted: 1,
    });
    if (out.kind !== "pool_read") return;
    const row = await emailRow(out.inboundId);
    expect(row).toMatchObject({ userId: null, parser: POOL_PARSER, jobsExtracted: 1, error: null });
    expect(row.seenAt).not.toBeNull();

    const jobs = await poolJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      sourceKind: "computrabajo_alerts",
      sourceName: "vía Computrabajo",
      externalId: ID_UNA,
      title: "Contador/a Ficticio",
      companyRaw: "Empresa A",
      countriesAllowed: null,
      roleHints: ["finanzas_contabilidad"],
    });
    expect(jobs[0]!.sourceUrl).toBe(
      `https://ar.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-contador-a-ficticio-${ID_UNA}`,
    );
    // El crudo del aviso no lleva parámetros del tracker
    const blob = await pgBlobStorage(conn.db).get(jobs[0]!.rawRef!);
    for (const rastro of ["ipo", "idu", "isd", "go.computrabajo"]) {
      expect(blob!.body, rastro).not.toContain(rastro);
    }
  });

  it("el mismo aviso en otro email no duplica la fila (dedup por ID)", async () => {
    const out = await receive(
      "lector_on_2",
      "finanzas_contabilidad",
      fixture("pool-alerta-una-tarjeta.html"),
      READER_ON,
    );
    expect(out).toMatchObject({ kind: "pool_read", jobsExtracted: 1 });
    expect(await poolJobs()).toHaveLength(1);
  });

  it("varios avisos de un email: uno por tarjeta, todos con la carrera de la casilla", async () => {
    const before = (await poolJobs()).length;
    const out = await receive(
      "lector_on_3",
      "rrhh_it",
      fixture("recomendaciones-tres-avisos.html"),
      READER_ON,
    );
    expect(out).toMatchObject({ kind: "pool_read", career: "rrhh_it", jobsExtracted: 3 });
    const jobs = await poolJobs();
    expect(jobs).toHaveLength(before + 3);
    const nuevos = jobs.filter((j) => j.externalId !== ID_UNA);
    expect(nuevos.map((j) => j.roleHints)).toEqual(Array(3).fill(["rrhh_it"]));
    expect(nuevos.every((j) => j.countriesAllowed === null)).toBe(true);
  });

  it("estructura desconocida: cola manual con motivo, sin texto del email y sin avisos nuevos", async () => {
    const before = (await poolJobs()).length;
    const out = await receive(
      "lector_on_4",
      "rrhh_it",
      fixture("pool-estructura-desconocida.html"),
      READER_ON,
    );
    expect(out.kind).toBe("pool_queued");
    if (out.kind !== "pool_queued") return;
    const row = await emailRow(out.inboundId);
    expect(row.jobsExtracted).toBe(0);
    expect(row.error).toContain(POOL_READER_FAILED_PREFIX);
    expect(row.error).not.toMatch(/Analista|Empresa A|http/);
    expect(row.seenAt).toBeNull();
    expect(await poolJobs()).toHaveLength(before);
  });

  it("recordatorio de la fuente: cola manual", async () => {
    const out = await receive(
      "lector_on_5",
      "rrhh_it",
      fixture("recordatorio-volve-a-revisar.html"),
      READER_ON,
    );
    expect(out.kind).toBe("pool_queued");
  });

  it("el email que pasa el tope de tamaño no se lee: solo metadatos", async () => {
    const before = (await poolJobs()).length;
    const grande =
      fixture("pool-alerta-una-tarjeta.html") + "<!--" + "x".repeat(300 * 1024) + "-->";
    const out = await receive("lector_on_6", "rrhh_it", grande, READER_ON);
    expect(out.kind).toBe("pool_queued");
    expect(await poolJobs()).toHaveLength(before);
  });

  it("las filas de la cola siguen sin usuario", async () => {
    const rows = await conn.db.select().from(s.inboundEmails).where(isNull(s.inboundEmails.userId));
    expect(rows.length).toBeGreaterThanOrEqual(7);
    const conUsuario = (await conn.db.execute(
      sql`select count(*)::int as n from inbound_emails where user_id is not null`,
    )) as unknown as { n: number }[];
    expect(conUsuario[0]!.n).toBe(0);
  });
});
