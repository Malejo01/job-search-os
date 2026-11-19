import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { compileTaxonomy, type RawJob } from "@job-search-os/pipeline";
import { eq, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignPoolToUser } from "./assign";
import { upsertPoolJobs } from "./upsert";

/**
 * Los campos de texto libre de una oferta del pool quedan recortados al insertarse, tanto por el
 * camino de un aviso como por el del lote, y al copiarse a la persona. Avisos inventados.
 */
const PREFIX = "topes-test-";
const USER = "a0000000-0000-4000-8000-0000000000e5";
const logger = pino({ level: "silent" });
const T0 = new Date("2026-10-12T12:00:00Z");
const HUGE = "y".repeat(2_000_000);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const taxonomy = compileTaxonomy([]);

const JD = (n: number) =>
  `Se busca persona para un equipo remoto numero ${n}, con pruebas automatizadas, despliegues continuos y revision de codigo entre pares todos los dias de la semana.`;

function rawJob(n: number, over: Partial<RawJob> = {}): RawJob {
  return {
    source: {
      kind: "remoteok",
      name: "Remote OK",
      externalId: `${PREFIX}${n}`,
      url: `https://example.com/jobs/${PREFIX}${n}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify({ n }) },
    },
    title: "Backend Developer",
    companyRaw: `Empresa Ficticia T${n}`,
    locationRaw: "Worldwide",
    countriesAllowed: null,
    modality: "remoto",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: JD(n),
    postedAt: null,
    tags: ["backend"],
    categories: ["engineering"],
    seniority: null,
    lang: null,
    ...over,
  };
}

const huge = (n: number): Partial<RawJob> => ({
  title: HUGE,
  companyRaw: `E${n} ${HUGE}`,
  locationRaw: HUGE,
  contractType: HUGE,
  salaryNote: HUGE,
});

async function publicRow(n: number) {
  const [r] = await conn.db
    .select()
    .from(s.publicJobs)
    .where(eq(s.publicJobs.externalId, `${PREFIX}${n}`));
  return r!;
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
  conn = createDb(ownerUrl, { max: 4 });
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_e5@ingest.test",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("pool: campos enormes quedan recortados al insertarse", () => {
  it("un aviso por la ruta individual", async () => {
    const out = await upsertPoolJobs([rawJob(1, huge(1))], {
      db: conn.db,
      logger,
      now: () => T0,
      taxonomy,
    });
    expect(out).toMatchObject({ inserted: 1, errors: 0 });
    const r = await publicRow(1);
    expect(r.title.length).toBeLessThanOrEqual(300);
    expect(r.companyRaw.length).toBeLessThanOrEqual(300);
    expect(r.locationRaw?.length ?? 0).toBeLessThanOrEqual(300);
    expect(r.contractType?.length ?? 0).toBeLessThanOrEqual(100);
    expect(r.salaryNote?.length ?? 0).toBeLessThanOrEqual(200);
  });

  it("varios avisos por la ruta del lote", async () => {
    const batch = [2, 3, 4, 5, 6, 7].map((n) => rawJob(n, huge(n)));
    const out = await upsertPoolJobs(batch, { db: conn.db, logger, now: () => T0, taxonomy });
    expect(out).toMatchObject({ inserted: 6, errors: 0 });
    for (const n of [2, 3, 4, 5, 6, 7]) {
      const r = await publicRow(n);
      expect(r.title.length).toBeLessThanOrEqual(300);
      expect(r.companyRaw.length).toBeLessThanOrEqual(300);
      expect(r.locationRaw?.length ?? 0).toBeLessThanOrEqual(300);
      expect(r.contractType?.length ?? 0).toBeLessThanOrEqual(100);
      expect(r.salaryNote?.length ?? 0).toBeLessThanOrEqual(200);
    }
  });
});

describe("pool: al copiar a la persona", () => {
  it("una fila vieja del pool con campos enormes llega recortada a jobs", async () => {
    await conn.db.insert(s.publicJobs).values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}old`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}old`,
      canonicalUrl: `https://example.com/jobs/${PREFIX}old`,
      title: HUGE,
      titleNormalized: "backend developer",
      companyRaw: `Empresa Ficticia Old ${HUGE}`,
      companyNormalized: "empresa ficticia old",
      locationRaw: HUGE,
      contractType: HUGE,
      salaryNote: HUGE,
      modality: "remoto",
      jdText: JD(99),
      jdHash: `${PREFIX}hash-old`,
      roleHints: [],
      postedAt: new Date(),
      firstSeenAt: new Date(Date.now() - 3_600_000),
      lastSeenAt: new Date(),
    });
    const r = await assignPoolToUser(conn.db, USER, { limit: 50, enqueueTop: 0, logger });
    expect(r.assigned).toBeGreaterThan(0);
    const jobs = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER));
    const old = jobs.find((j) => j.titleNormalized === "backend developer" && j.title.length > 10);
    expect(old).toBeDefined();
    expect(old!.title.length).toBeLessThanOrEqual(300);
    expect(old!.companyRaw.length).toBeLessThanOrEqual(300);
    expect(old!.locationRaw?.length ?? 0).toBeLessThanOrEqual(300);
    expect(old!.contractType?.length ?? 0).toBeLessThanOrEqual(100);
    expect(old!.salaryNote?.length ?? 0).toBeLessThanOrEqual(200);
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER));
    await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  });
});
