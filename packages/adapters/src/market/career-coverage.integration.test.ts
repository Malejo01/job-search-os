import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import { careerCoverage } from "@job-search-os/pipeline";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readCareerCoverageJobs } from "./career-coverage";

/**
 * R32-02 · Lectura del pool para el panel de cobertura. Datos inventados, con prefijo propio y carreras
 * inventadas: la consulta recibe la lista de carreras, así que nada más de la base entra en los números.
 */
const PREFIX = "career-coverage-test-";
const ROLE_A = "r32-2-a";
const ROLE_B = "r32-2-b";
const NOW = new Date("2026-11-26T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

type Insert = typeof s.publicJobs.$inferInsert;
const row = (over: Partial<Insert> = {}): Insert => {
  const n = ++seq;
  return {
    sourceKind: "remoteok",
    externalId: `${PREFIX}${n}`,
    sourceName: "Fuente ficticia",
    sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
    title: `Puesto ficticio ${n}`,
    titleNormalized: `puesto ficticio ${n}`,
    companyRaw: `Empresa Ficticia ${n}`,
    companyNormalized: `empresa ficticia ${n}`,
    roleHints: [ROLE_A],
    countriesAllowed: ["AR"],
    firstSeenAt: day(40),
    lastSeenAt: day(1),
    ...over,
  };
};

async function insertAll(rows: Insert[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await conn.db.insert(s.publicJobs).values(rows.slice(i, i + 500));
  }
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
  if (isRemoteDatabase(ownerUrl))
    throw new Error("career-coverage.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
}, 180_000);

const clean = () => conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));

beforeEach(clean);

afterAll(async () => {
  await clean();
  await conn?.close();
  await container?.stop();
});

describe("readCareerCoverageJobs", () => {
  it("trae solo avisos de las carreras pedidas, sin copias y vistos en los últimos 14 días", async () => {
    await insertAll([
      row(), // entra
      row({ roleHints: [ROLE_A, ROLE_B] }), // entra
      row({ roleHints: ["otra-carrera"] }), // otra carrera
      row({ roleHints: [] }), // sin carrera
      row({ lastSeenAt: day(15) }), // fuera de la ventana
    ]);
    const [original] = await conn.db.select({ id: s.publicJobs.id }).from(s.publicJobs).limit(1);
    await conn.db.insert(s.publicJobs).values(row({ dedupOfId: original!.id })); // copia
    const jobs = await readCareerCoverageJobs(conn.db, [ROLE_A, ROLE_B], NOW);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]?.firstSeenAt).toBeInstanceOf(Date);
  });

  it("sin carreras no consulta nada", async () => {
    expect(await readCareerCoverageJobs(conn.db, [], NOW)).toEqual([]);
  });

  it("alimenta careerCoverage: vigentes, tomables, para quien empieza, idioma y fuente", async () => {
    await insertAll([
      row({ lang: "es" }),
      row({ seniority: "Junior", jdLanguage: "en", lang: "es" }), // el calculado manda sobre el declarado
      row({ countriesAllowed: null }), // vigente, no tomable
      row({ lastSeenAt: day(10) }), // no vigente
      row({ sourceKind: "wwr", countriesAllowed: ["LATAM"] }),
    ]);
    const jobs = await readCareerCoverageJobs(conn.db, [ROLE_A], NOW);
    const [r] = careerCoverage([ROLE_A], jobs, NOW);
    expect(r).toMatchObject({ vigentes: 4, tomables: 3, paraEmpezar: 1, enEspanol: 1 });
    expect(r?.sources.map((x) => x.source)).toEqual(["remoteok", "wwr"]);
    // Todos entraron hace 40 días: hay historia y ninguna es nueva en los últimos 14
    expect(r?.trend).toMatchObject({ ultimos7: 0, previos7: 0 });
  });

  it("con datos sembrados responde rápido (una consulta)", async () => {
    const rows: Insert[] = [];
    for (let i = 0; i < 6000; i++) {
      rows.push(
        row({
          roleHints: [i % 3 === 0 ? ROLE_A : i % 3 === 1 ? ROLE_B : "otra-carrera"],
          countriesAllowed: i % 4 === 0 ? null : ["AR"],
          firstSeenAt: day(i % 40),
          lastSeenAt: day(i % 20),
        }),
      );
    }
    await insertAll(rows);
    const t0 = performance.now();
    const jobs = await readCareerCoverageJobs(conn.db, [ROLE_A, ROLE_B], NOW);
    const ms = performance.now() - t0;
    const t1 = performance.now();
    const coverage = careerCoverage([ROLE_A, ROLE_B], jobs, NOW);
    const calcMs = performance.now() - t1;
    expect(jobs.length).toBeGreaterThan(1000);
    expect(coverage).toHaveLength(2);
    console.info(
      `career-coverage: 6000 avisos sembrados, lectura ${ms.toFixed(0)} ms, cuenta ${calcMs.toFixed(0)} ms`,
    );
    // Margen amplio: el panel corta con statement_timeout de 3 s
    expect(ms).toBeLessThan(2000);
    expect(calcMs).toBeLessThan(1000);
  });
});
