import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { checkJdSize, JD_HARD_MAX_CHARS, rawJobFromManual } from "@job-search-os/pipeline";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ingestRawJob } from "./ingest-job";

/**
 * Una JD enorme que llega por fusión a una oferta que espera su descripción entra recortada al
 * máximo duro: la oferta no queda trabada y la evaluación posterior no la rechaza por tamaño.
 */
const USER = "a0000000-0000-4000-8000-000000000007";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const logger = pino({ level: "silent" });
const run = Math.random().toString(36).slice(2, 8);
let n = 0;

const manual = (url: string, jdText: string | null, company: string) =>
  rawJobFromManual({
    url,
    title: "Backend Engineer (Datos)",
    company,
    locationRaw: "Remoto (Argentina)",
    modality: "remoto",
    jdText,
  });
const job = async (id: string) =>
  (await conn.db.select().from(s.jobs).where(eq(s.jobs.id, id)))[0]!;

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_a0000000_7@ingest.test",
      profileSummary: "AI Engineer.",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("JD enorme por fusión", () => {
  it.each([JD_HARD_MAX_CHARS + 50_000, 2_000_000])(
    "con %i caracteres a una oferta pendiente_jd queda recortada y se encola",
    async (size) => {
      n += 1;
      const url = `https://empresa-g.example/jobs/enorme-${run}-${n}`;
      const company = `Empresa G ${n}`;
      const first = await ingestRawJob(manual(url, null, company), {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
      });
      expect((await job(first.jobId)).status).toBe("pendiente_jd");

      const enqueued: string[] = [];
      const huge = manual(
        url,
        "Plataforma de datos con TypeScript y Postgres. ".repeat(60_000),
        company,
      );
      huge.jdText = huge.jdText!.slice(0, size).padEnd(size, "x");
      const second = await ingestRawJob(huge, {
        db: conn.db,
        userId: USER,
        rules: criteria as never,
        logger,
        enqueueEvaluation: async (jobId) => {
          enqueued.push(jobId);
        },
      });
      expect(second).toMatchObject({ action: "merged", jobId: first.jobId });

      const saved = await job(first.jobId);
      expect(saved.jdText!.length).toBeLessThanOrEqual(JD_HARD_MAX_CHARS);
      expect(checkJdSize(saved.jdText)).toMatchObject({ ok: true });
      expect(enqueued).toEqual([first.jobId]);
    },
  );
});
