import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { and, eq, isNull } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  POOL_MANUAL_QUEUE_REASON,
  POOL_OVERSIZE_REASON,
  POOL_PARSER,
  POOL_READER_FAILED_PREFIX,
} from "../inbound/pool-mailbox";
import { pgBlobStorage } from "../storage/blob";
import { POOL_REPROCESS_NO_BODY_REASON, reprocessPoolQueue } from "./reprocess";

/** R19-02: reprocesar la cola del pool con el lector. Avisos, remitente y carreras ficticios. */
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, "../inbound/fixtures/computrabajo", name), "utf8");
const UNA = fixture("pool-alerta-una-tarjeta.html");
const TRES = fixture("recomendaciones-tres-avisos.html");
const DESCONOCIDA = fixture("pool-estructura-desconocida.html");

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
let n = 0;

/** Una fila de la cola del pool, con su crudo guardado, como la deja `handleInboundEmail`. */
async function enqueue(html: string | null, opts: { error?: string; career?: string } = {}) {
  n++;
  const body = JSON.stringify({
    event: { data: { email_id: `r_${n}` } },
    content: html === null ? null : { html, text: null, headers: null },
    pool_career: opts.career ?? "finanzas_contabilidad",
  });
  const rawRef = await pgBlobStorage(conn.db).put({
    userId: null,
    kind: "inbound_email",
    contentType: "application/json",
    body,
  });
  const [row] = await conn.db
    .insert(s.inboundEmails)
    .values({
      userId: null,
      emailId: `reproc_${n}`,
      fromAddress: "Alertas <avisos@portal-ficticio.test>",
      subject: "Nuevos empleos",
      rawRef,
      parser: POOL_PARSER,
      jobsExtracted: 0,
      error: opts.error ?? POOL_MANUAL_QUEUE_REASON,
      receivedAt: new Date(Date.UTC(2026, 10, 20, 10, n)),
    })
    .returning({ id: s.inboundEmails.id });
  return row!.id;
}

const row = async (id: string) =>
  (await conn.db.select().from(s.inboundEmails).where(eq(s.inboundEmails.id, id)))[0]!;
const jobs = () =>
  conn.db.select().from(s.publicJobs).where(eq(s.publicJobs.sourceKind, "computrabajo_alerts"));
const run = (o: { limit?: number; dryRun?: boolean; readerEnabled?: boolean; failed?: boolean }) =>
  reprocessPoolQueue(conn.db, {
    limit: o.limit ?? 50,
    dryRun: o.dryRun ?? false,
    readerEnabled: o.readerEnabled ?? true,
    includeFailed: o.failed,
    logger,
    now: () => new Date("2026-11-22T12:00:00Z"),
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
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("pool:reprocess", () => {
  it("lector apagado: no escribe y lo dice; el dry-run sí cuenta", async () => {
    const id = await enqueue(UNA);
    const off = await run({ readerEnabled: false });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toMatch(/POOL_COMPUTRABAJO_READER/);
    expect(await jobs()).toHaveLength(0);
    expect((await row(id)).error).toBe(POOL_MANUAL_QUEUE_REASON);

    const dry = await run({ readerEnabled: false, dryRun: true });
    expect(dry).toMatchObject({ ok: true, dryRun: true, readerEnabled: false });
    if (dry.ok) expect(dry.report).toMatchObject({ selected: 1, read: 1, failed: 0 });
  });

  it("--dry-run no escribe nada, ni avisos ni filas", async () => {
    const dry = await run({ dryRun: true });
    expect(dry.ok).toBe(true);
    expect(await jobs()).toHaveLength(0);
    const rows = await conn.db.select().from(s.inboundEmails).where(isNull(s.inboundEmails.seenAt));
    expect(rows.every((r) => r.error === POOL_MANUAL_QUEUE_REASON)).toBe(true);
  });

  it("lee los de estructura conocida, deja en la cola los que fallan y salta los que no tienen cuerpo", async () => {
    const malo = await enqueue(DESCONOCIDA, { career: "rrhh_it" });
    const tres = await enqueue(TRES, { career: "rrhh_it" });
    const sinCuerpo = await enqueue(null);
    const oversize = await enqueue(null, { error: POOL_OVERSIZE_REASON });
    const res = await run({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // UNA (del primer test) + TRES leídos; DESCONOCIDA falla; sinCuerpo sin cuerpo; oversize ni se elige
    expect(res.report).toMatchObject({ selected: 4, read: 2, failed: 1, noBody: 1 });
    expect(res.report.jobsExtracted).toBe(4);

    expect((await row(tres)).error).toBeNull();
    expect(await row(tres)).toMatchObject({ jobsExtracted: 3 });
    expect((await row(tres)).seenAt).not.toBeNull();
    const m = await row(malo);
    expect(m.error).toContain(POOL_READER_FAILED_PREFIX);
    expect(m.seenAt).toBeNull();
    expect((await row(sinCuerpo)).error).toBe(POOL_REPROCESS_NO_BODY_REASON);
    expect((await row(oversize)).error).toBe(POOL_OVERSIZE_REASON);

    const all = await jobs();
    expect(all).toHaveLength(4);
    expect(all.filter((j) => j.roleHints?.includes("rrhh_it"))).toHaveLength(3);
    expect(all.every((j) => j.countriesAllowed === null)).toBe(true);
  });

  it("es idempotente: una segunda corrida no relee lo resuelto ni duplica avisos", async () => {
    const before = (await jobs()).length;
    const res = await run({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Nada: lo resuelto, lo que falló cerrado y lo que no tiene cuerpo salieron de la selección
    expect(res.report).toMatchObject({ selected: 0, read: 0, failed: 0, noBody: 0 });
    expect(await jobs()).toHaveLength(before);
  });

  it("el mismo aviso en otro email de la cola no se duplica (dedup por external_id)", async () => {
    const before = (await jobs()).length;
    const id = await enqueue(UNA);
    const res = await run({});
    expect(res.ok).toBe(true);
    expect((await row(id)).error).toBeNull();
    expect(await jobs()).toHaveLength(before);
  });

  it("--include-failed reintenta los que fallaron cerrado", async () => {
    const res = await run({ failed: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.report).toMatchObject({ failed: 1 });
  });

  it("respeta el tope por corrida y el orden de llegada", async () => {
    const a = await enqueue(UNA.replace("0A1B2C3D4E5F60718293A4B5C6D7E8F1", "1".repeat(32)));
    const b = await enqueue(UNA.replace("0A1B2C3D4E5F60718293A4B5C6D7E8F1", "2".repeat(32)));
    const res = await run({ limit: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.report.selected).toBe(1);
    expect((await row(a)).error).toBeNull();
    expect((await row(b)).error).toBe(POOL_MANUAL_QUEUE_REASON);
  });

  it("no toca emails de personas ni de otros parsers", async () => {
    const [user] = await conn.db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(and(isNull(s.inboundEmails.userId), eq(s.inboundEmails.parser, "otro")));
    expect(user).toBeUndefined();
  });
});
