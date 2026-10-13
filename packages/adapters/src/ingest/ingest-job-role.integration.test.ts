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
 * Ronda 40 (ADR-015) · El prefiltro de la ingesta por usuario recibe `profiles.target_role`: quien
 * busca marketing digital ingiere "SEO Specialist"; quien no tiene puesto lo descarta.
 */
const MARKETING = "a4000000-0000-4000-8000-000000000001";
const SIN_PUESTO = "a4000000-0000-4000-8000-000000000002";
const INVALIDO = "a4000000-0000-4000-8000-000000000003";
const VARIOS = "a4000000-0000-4000-8000-000000000004";
const USERS = [MARKETING, SIN_PUESTO, INVALIDO, VARIOS];

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });

async function ingestSeo(userId: string, extra: { targetRoles?: null } = {}) {
  const out = await ingestBatch(
    [
      rawJobFromManual({
        url: `https://empresa-a.example/jobs/seo-${userId.slice(-1)}`,
        title: "SEO Specialist",
        company: "Empresa A",
        locationRaw: "Remoto",
        modality: "remoto",
        jdText:
          "Buscamos SEO Specialist para posicionamiento orgánico y contenidos. Trabajo remoto.",
      }),
    ],
    { db: conn.db, userId, rules: criteria as never, logger, ...extra },
  );
  expect(out.errors).toEqual([]);
  const [job] = await conn.db
    .select({ status: s.jobs.status })
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
    .values(USERS.map((id, i) => ({ id, email: `u${i}@puesto.test`, passwordHash: "x" })));
  const profile = (userId: string, targetRoles: string[]) => ({
    userId,
    displayName: "Test",
    locationCountry: "AR",
    remoteOnly: true,
    targetRole: targetRoles[0] ?? null,
    targetRoles,
    inboundAddress: `p_${userId.slice(0, 8)}_${userId.slice(-1)}@ingest.test`,
    profileSummary: "Perfil de prueba.",
  });
  await conn.db
    .insert(s.profiles)
    .values([
      profile(MARKETING, ["marketing_digital"]),
      profile(SIN_PUESTO, []),
      profile(INVALIDO, ["no_es_un_puesto"]),
      profile(VARIOS, ["frontend", "marketing_digital", "marketing_digital", "no_es_un_puesto"]),
    ]);
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

describe("Rondas 40 y 45: target_roles del perfil en el prefiltro de la ingesta", () => {
  it("loadProfilePrefilterPrefs: devuelve los puestos válidos; inválidos o sin perfil, []", async () => {
    expect((await loadProfilePrefilterPrefs(conn.db, MARKETING)).targetRoles).toEqual([
      "marketing_digital",
    ]);
    expect((await loadProfilePrefilterPrefs(conn.db, SIN_PUESTO)).targetRoles).toEqual([]);
    expect((await loadProfilePrefilterPrefs(conn.db, INVALIDO)).targetRoles).toEqual([]);
    expect((await loadProfilePrefilterPrefs(conn.db, VARIOS)).targetRoles).toEqual([
      "frontend",
      "marketing_digital",
    ]);
  });

  it("varios puestos: 'SEO Specialist' pasa por la unión de oficios", async () => {
    expect((await ingestSeo(VARIOS))?.status).toBe("prefiltrada");
  });

  it("marketing_digital: 'SEO Specialist' pasa", async () => {
    expect((await ingestSeo(MARKETING))?.status).toBe("prefiltrada");
  });

  it("sin puesto: 'SEO Specialist' se descarta", async () => {
    expect((await ingestSeo(SIN_PUESTO))?.status).toBe("descartada_prefiltro");
  });

  it("targetRoles inyectado en deps (null) gana sobre el perfil", async () => {
    // Mismo usuario de marketing, pero con los puestos forzados a null: se descarta
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, MARKETING));
    expect((await ingestSeo(MARKETING, { targetRoles: null }))?.status).toBe(
      "descartada_prefiltro",
    );
  });
});
