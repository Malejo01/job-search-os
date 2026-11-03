import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { jobLanguageFacts, type RoleKey } from "@job-search-os/pipeline";
import { eq, isNull, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readCareerMarketInput } from "../market/career-market";
import { backfillJobLanguage } from "./backfill-language";

/**
 * C8-15 · relleno del idioma de `public_jobs` y lectura del mercado con las columnas. Avisos inventados
 * (Empresa Ficticia), conexión dueña. Nunca contra una base remota.
 */
const PREFIX = "lang-test-";
const NOW = new Date("2026-11-03T12:00:00Z");
const JD_EN =
  "We are looking for a Program Officer to join our team. You will manage the grants portfolio and work with our partners across the region. Fluent English is required and Spanish is a plus.";
const JD_ES =
  "Buscamos una persona para el área legal de la empresa. Vas a redactar contratos y acompañar a los equipos en los reclamos de clientes. Se valora inglés intermedio.";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function seed(id: string, jdText: string, role: RoleKey): Promise<void> {
  await conn.db.insert(s.publicJobs).values({
    sourceKind: "remoteok",
    externalId: `${PREFIX}${id}`,
    sourceName: "Remote OK",
    sourceUrl: `https://example.com/jobs/${PREFIX}${id}`,
    title: "Analista",
    titleNormalized: "analista",
    companyRaw: "Empresa Ficticia 1",
    companyNormalized: "empresa ficticia 1",
    roleHints: [role],
    jdText,
    tags: [],
    categories: [],
    firstSeenAt: NOW,
    lastSeenAt: NOW,
  });
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
  if (isRemoteDatabase(ownerUrl)) throw new Error("backfill-language: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await seed("en", JD_EN, "relaciones_internacionales");
  await seed("es", JD_ES, "relaciones_internacionales");
}, 180_000);

afterAll(async () => {
  await conn?.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await conn?.close();
  await container?.stop();
});

describe("backfillJobLanguage (C8-15)", () => {
  it("sin --apply solo cuenta", async () => {
    const r = await backfillJobLanguage(conn.db, { apply: false });
    expect(r.pending).toBeGreaterThanOrEqual(2);
    expect(r.written).toBe(0);
  });

  it("rellena con lo mismo que calcula el pipeline y es idempotente", async () => {
    await backfillJobLanguage(conn.db, { apply: true, now: NOW });
    const [en] = await conn.db
      .select()
      .from(s.publicJobs)
      .where(eq(s.publicJobs.externalId, `${PREFIX}en`));
    const f = jobLanguageFacts(JD_EN, null);
    expect(en).toMatchObject({
      jdLanguage: f.jdLanguage,
      englishLanguage: f.englishLanguage,
      englishAsks: f.englishAsks,
      englishLevel: f.englishLevel,
    });
    expect(en!.languageCheckedAt).not.toBeNull();
    const again = await backfillJobLanguage(conn.db, { apply: true });
    expect(again.written).toBe(0);
    const left = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(isNull(s.publicJobs.languageCheckedAt));
    expect(left).toEqual([]);
  });

  it("el mercado con las columnas no trae el texto y da los mismos datos de idioma", async () => {
    const withText = await readCareerMarketInput(conn.db, "relaciones_internacionales", NOW);
    const persisted = await readCareerMarketInput(conn.db, "relaciones_internacionales", NOW, {
      persistedLanguage: true,
    });
    const mine = (x: typeof persisted) =>
      x.jobs.filter((j) => j.id && withText.jobs.some((w) => w.id === j.id));
    for (const j of mine(persisted)) {
      expect(j.jdText).toBeNull();
      const w = withText.jobs.find((x) => x.id === j.id)!;
      expect(j.language).toEqual(jobLanguageFacts(w.jdText, w.lang));
    }
  });
});
