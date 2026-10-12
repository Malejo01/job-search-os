import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { rawJobFromManual } from "@job-search-os/pipeline";
import { eq, inArray } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestBatch, loadProfilePrefilterPrefs } from "./ingest-job";

/**
 * Ronda 34 · El prefiltro usa `profiles.remote_only`: con `false`, una oferta híbrida pasa con el
 * flag `modalidad_no_remota`; con `true` (o sin perfil) se descarta, como hasta ahora.
 */
const ABIERTO = "a3400000-0000-4000-8000-000000000001";
const SOLO_REMOTO = "a3400000-0000-4000-8000-000000000002";
const SIN_PERFIL = "a3400000-0000-4000-8000-000000000003";
const USERS = [ABIERTO, SOLO_REMOTO, SIN_PERFIL];

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function ingestHybrid(userId: string) {
  const out = await ingestBatch(
    [
      rawJobFromManual({
        url: `https://empresa-a.example/jobs/hibrido-${userId.slice(-1)}`,
        title: "Backend Engineer",
        company: "Empresa A",
        locationRaw: "Buenos Aires",
        modality: "hibrido",
        jdText: "Buscamos backend engineer con TypeScript, Postgres y colas. Modalidad híbrida.",
      }),
    ],
    { db: conn.db, userId, rules: criteria as never, logger },
  );
  expect(out.errors).toEqual([]);
  const [job] = await conn.db
    .select({ status: s.jobs.status, flags: s.jobs.flags })
    .from(s.jobs)
    .where(eq(s.jobs.userId, userId));
  return job;
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
    .values(USERS.map((id, i) => ({ id, email: `u${i}@remoto.test`, passwordHash: "x" })));
  const profile = (userId: string, remoteOnly: boolean) => ({
    userId,
    displayName: "Test",
    locationCountry: "AR",
    remoteOnly,
    inboundAddress: `r_${userId.slice(0, 8)}_${userId.slice(-1)}@ingest.test`,
    profileSummary: "Backend Engineer.",
  });
  await conn.db.insert(s.profiles).values([profile(ABIERTO, false), profile(SOLO_REMOTO, true)]);
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

describe("Ronda 34: remote_only del perfil en el prefiltro de la ingesta", () => {
  it("loadProfilePrefilterPrefs: lee remote_only; sin perfil es true", async () => {
    expect((await loadProfilePrefilterPrefs(conn.db, ABIERTO)).remoteOnly).toBe(false);
    expect((await loadProfilePrefilterPrefs(conn.db, SOLO_REMOTO)).remoteOnly).toBe(true);
    expect((await loadProfilePrefilterPrefs(conn.db, SIN_PERFIL)).remoteOnly).toBe(true);
  });

  it("remote_only = false: la híbrida pasa con el flag modalidad_no_remota", async () => {
    const job = await ingestHybrid(ABIERTO);
    expect(job?.status).toBe("prefiltrada");
    expect(job?.flags).toContain("modalidad_no_remota");
  });

  it("remote_only = true: la híbrida se descarta", async () => {
    const job = await ingestHybrid(SOLO_REMOTO);
    expect(job?.status).toBe("descartada_prefiltro");
  });

  it("sin perfil: se descarta (lo conservador)", async () => {
    const job = await ingestHybrid(SIN_PERFIL);
    expect(job?.status).toBe("descartada_prefiltro");
  });
});
