import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { BETA_LAUNCH_ROLE_KEYS, SHOWCASE_SOURCES } from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readBetaPoolCounts } from "./beta-counts";

/**
 * R11-10 · Número de la portada: ofertas activas de las carreras de la beta y cuántas en español.
 * Datos inventados, con prefijo propio para no pisar a las otras pruebas del pool.
 */
const PREFIX = "beta-counts-test-";
const NOW = new Date("2026-11-13T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function pool(over: Partial<typeof s.publicJobs.$inferInsert> = {}) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: `Puesto ficticio ${n}`,
      titleNormalized: `puesto ficticio ${n}`,
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      roleHints: ["abogacia"],
      firstSeenAt: day(2),
      lastSeenAt: NOW,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
}

const count = () => readBetaPoolCounts(conn.db, NOW, SHOWCASE_SOURCES, BETA_LAUNCH_ROLE_KEYS);

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

beforeEach(async () => {
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
});

describe("readBetaPoolCounts", () => {
  it("cuenta solo las ofertas activas de las carreras de la beta", async () => {
    const before = await count();
    await pool({ roleHints: ["abogacia"] });
    await pool({ roleHints: ["finanzas_contabilidad", "comunicacion"] });
    await pool({ roleHints: ["qa"] }); // carrera que no es de la beta
    await pool({ roleHints: [] }); // sin carrera
    const after = await count();
    expect(after.total - before.total).toBe(2);
  });

  it("un aviso con varias carreras de la beta cuenta una sola vez", async () => {
    const before = await count();
    await pool({ roleHints: ["abogacia", "administracion_empresas", "comunicacion"] });
    expect((await count()).total - before.total).toBe(1);
  });

  it("deja afuera copias, avisos viejos y fuentes que no están permitidas", async () => {
    const before = await count();
    const original = await pool({ roleHints: ["abogacia"] });
    await pool({ roleHints: ["abogacia"], dedupOfId: original });
    await pool({ roleHints: ["abogacia"], lastSeenAt: day(8) });
    await pool({ roleHints: ["abogacia"], sourceKind: "wwr" });
    expect((await count()).total - before.total).toBe(1);
  });

  it("«en español» usa el idioma calculado y, si falta, el que declara la fuente", async () => {
    const before = await count();
    await pool({ jdLanguage: "es" });
    await pool({ jdLanguage: "en", lang: "es" }); // el calculado manda
    await pool({ jdLanguage: null, lang: "es" });
    await pool({ jdLanguage: null, lang: null }); // sin dato: no se cuenta
    const after = await count();
    expect(after.total - before.total).toBe(4);
    expect(after.spanish - before.spanish).toBe(2);
  });

  it("sin carreras o sin fuentes no lee nada", async () => {
    expect(await readBetaPoolCounts(conn.db, NOW, SHOWCASE_SOURCES, [])).toEqual({
      total: 0,
      spanish: 0,
    });
    expect(await readBetaPoolCounts(conn.db, NOW, [], BETA_LAUNCH_ROLE_KEYS)).toEqual({
      total: 0,
      spanish: 0,
    });
  });
});
