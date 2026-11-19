import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "../ingest/ingest-job";
import { PersonQuotaError, reservePersonQuota } from "../quota/person-quota";
import { pgBlobStorage } from "../storage/blob";

/**
 * Cuotas por persona: se deciden con un lock por persona dentro de la misma transacción que
 * guarda, así que los pedidos en paralelo no pasan todos por el mismo hueco. Topes chicos para
 * poder llegar a ellos. Datos inventados.
 */
const A = "a4100000-0000-4000-8000-000000000001";
const B = "b4100000-0000-4000-8000-000000000002";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function seedUser(userId: string, tag: string) {
  await conn.db
    .insert(s.profiles)
    .values({
      userId,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: `u_${tag}q@ingest.test`,
      profileSummary: "Perfil de prueba.",
    })
    .onConflictDoNothing();
}

/** Alta manual como la hace la web y el MCP: reservar y guardar en la misma transacción. */
async function addManualJob(userId: string, tag: string, maxManualJobs: number) {
  return conn.db.transaction(async (tx) => {
    const raw = rawJobFromManual({
      url: `https://example.test/jobs/${tag}`,
      title: `Analista ${tag}`,
      company: `Empresa ${tag}`,
      locationRaw: "Córdoba",
      modality: "presencial",
      jdText: null,
    });
    await reservePersonQuota(
      tx,
      userId,
      { newManualJobs: 1, incomingBytes: Buffer.byteLength(raw.source.original?.body ?? "") },
      { maxManualJobs, maxRawBytes: 1_000_000_000 },
    );
    return ingestRawJob(raw, { db: tx, userId, rules: criteria as never, logger });
  });
}

/** Pegado de una JD: reservar bytes y guardar el crudo en la misma transacción. */
async function addBlob(userId: string, size: number, maxRawBytes: number) {
  return conn.db.transaction(async (tx) => {
    await reservePersonQuota(
      tx,
      userId,
      { newManualJobs: 0, incomingBytes: size },
      { maxManualJobs: 1_000_000, maxRawBytes },
    );
    return pgBlobStorage(tx).put({
      userId,
      kind: "jd_pegada",
      contentType: "text/plain",
      body: "x".repeat(size),
    });
  });
}

const outcomes = (results: PromiseSettledResult<unknown>[]) => ({
  ok: results.filter((r) => r.status === "fulfilled").length,
  quota: results.filter((r) => r.status === "rejected" && r.reason instanceof PersonQuotaError)
    .length,
  other: results.filter((r) => r.status === "rejected" && !(r.reason instanceof PersonQuotaError))
    .length,
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
  conn = createDb(ownerUrl, { max: 12 });
  await seedUser(A, "a41");
  await seedUser(B, "b41");
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("cuota de ofertas manuales", () => {
  it("diez altas en paralelo con tope 3: entran exactamente 3", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => addManualJob(A, `par-${i}`, 3)),
    );
    expect(outcomes(results)).toEqual({ ok: 3, quota: 7, other: 0 });
  });

  it("con el tope lleno, una alta más falla con el motivo de ofertas", async () => {
    await expect(addManualJob(A, "extra", 3)).rejects.toMatchObject({
      name: "PersonQuotaError",
      kind: "manual_jobs",
    });
  });

  it("el tope de una persona no frena a otra", async () => {
    await expect(addManualJob(B, "otra-persona", 3)).resolves.toMatchObject({
      action: "inserted",
    });
  });
});

describe("cuota de bytes de raw_blobs", () => {
  it("diez pegados de 100 bytes en paralelo con tope 350: entran 3", async () => {
    const before = await conn.db
      .select({ bytes: s.rawBlobs.bytes })
      .from(s.rawBlobs)
      .where(eqUser(B));
    const used = before.reduce((sum, r) => sum + r.bytes, 0);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => addBlob(B, 100, used + 350)),
    );
    expect(outcomes(results)).toEqual({ ok: 3, quota: 7, other: 0 });
  });

  it("un pegado que solo no entra falla con el motivo de bytes", async () => {
    await expect(addBlob(A, 10_000_000, 1_000)).rejects.toMatchObject({
      name: "PersonQuotaError",
      kind: "raw_bytes",
    });
  });
});

function eqUser(userId: string) {
  return eq(s.rawBlobs.userId, userId);
}
