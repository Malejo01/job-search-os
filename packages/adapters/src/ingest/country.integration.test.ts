import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestBatch, loadProfileCountry } from "./ingest-job";

/**
 * JS-104 · El prefiltro usa el país del perfil: una oferta restringida al país del perfil pasa sin
 * riesgo de ubicación; el valor por defecto del registro ('XX'), vacío o sin perfil cuentan como
 * país desconocido y toda restricción queda con riesgo.
 */
const MX = "a1040000-0000-4000-8000-000000000001";
const AR = "a1040000-0000-4000-8000-000000000002";
const XX = "a1040000-0000-4000-8000-000000000003";
const SIN_PERFIL = "a1040000-0000-4000-8000-000000000004";
const VACIO = "a1040000-0000-4000-8000-000000000005";
const USERS = [MX, AR, XX, SIN_PERFIL, VACIO];

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

const offer = (slug: string, locationRaw: string) =>
  rawJobFromManual({
    url: `https://empresa-a.example/jobs/${slug}`,
    title: "Backend Engineer",
    company: "Empresa A",
    locationRaw,
    modality: "remoto",
    jdText: `Buscamos backend engineer para ${slug}. TypeScript, Postgres y colas. ${locationRaw}.`,
  });

async function flagsAfter(userId: string, locationRaw: string): Promise<string[]> {
  const out = await ingestBatch([offer(`${userId.slice(-1)}-${Date.now()}`, locationRaw)], {
    db: conn.db,
    userId,
    rules: criteria as never,
    logger,
  });
  expect(out.errors).toEqual([]);
  const [job] = await conn.db
    .select({ flags: s.jobs.flags })
    .from(s.jobs)
    .where(eq(s.jobs.userId, userId));
  return job?.flags ?? [];
}

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
  await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, USERS));
  await conn.db.delete(s.users).where(inArray(s.users.id, USERS));
  await conn.db
    .insert(s.users)
    .values(USERS.map((id, i) => ({ id, email: `u${i}@pais.test`, passwordHash: "x" })));
  const profile = (userId: string, locationCountry: string) => ({
    userId,
    displayName: "Test",
    locationCountry,
    remoteOnly: true,
    inboundAddress: `u_${userId.slice(0, 8)}_${userId.slice(-1)}@ingest.test`,
    profileSummary: "Backend Engineer.",
  });
  await conn.db
    .insert(s.profiles)
    .values([profile(MX, "MX"), profile(AR, "AR"), profile(XX, "XX"), profile(VACIO, "  ")]);
}, 180_000);

afterAll(async () => {
  if (conn) {
    await conn.db.delete(s.jobs).where(inArray(s.jobs.userId, USERS));
    await conn.db.delete(s.profiles).where(inArray(s.profiles.userId, USERS));
    await conn.db.delete(s.users).where(inArray(s.users.id, USERS));
  }
  await conn?.close();
  await container?.stop();
});

describe("JS-104: país del perfil en el prefiltro de la ingesta", () => {
  it("loadProfileCountry: 'XX', vacío y sin perfil son null; un país válido, en mayúsculas", async () => {
    expect(await loadProfileCountry(conn.db, MX)).toBe("MX");
    expect(await loadProfileCountry(conn.db, XX)).toBeNull();
    expect(await loadProfileCountry(conn.db, VACIO)).toBeNull();
    expect(await loadProfileCountry(conn.db, SIN_PERFIL)).toBeNull();
  });

  it("perfil MX: una oferta restringida a México pasa sin riesgo", async () => {
    expect(await flagsAfter(MX, "Mexico only")).not.toContain("location_risk");
  });

  it("perfil AR: la misma oferta restringida a México queda con riesgo", async () => {
    expect(await flagsAfter(AR, "Mexico only")).toContain("location_risk");
  });

  it("perfil 'XX', vacío o ausente: una oferta restringida queda con riesgo", async () => {
    expect(await flagsAfter(XX, "Mexico only")).toContain("location_risk");
    expect(await flagsAfter(VACIO, "Mexico only")).toContain("location_risk");
    expect(await flagsAfter(SIN_PERFIL, "Mexico only")).toContain("location_risk");
  });
});
