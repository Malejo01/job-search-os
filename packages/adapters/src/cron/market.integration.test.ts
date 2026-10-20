import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMarketCron } from "./market";

/** Ronda 62 · runMarketCron con un usuario y una oferta con skills. Datos inventados. */
const USER = "c0000000-0000-4000-8000-0000000000c2";
const logger = pino({ level: "silent" });

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

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
      targetRole: "qa",
      targetRoles: ["qa"],
      inboundAddress: "u_cron_c2@ingest.test",
    })
    .onConflictDoNothing();
  const [skill] = await conn.db
    .insert(s.skills)
    .values({ slug: "cron_s1", name: "Skill cron_s1", category: "otra" })
    .onConflictDoUpdate({ target: s.skills.slug, set: { name: "Skill cron_s1" } })
    .returning({ id: s.skills.id });
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId: USER,
      companyRaw: "Empresa Ficticia 1",
      title: "QA Engineer",
      titleNormalized: "qa engineer",
    })
    .returning({ id: s.jobs.id });
  await conn.db.insert(s.jobSkills).values({ jobId: job!.id, skillId: skill!.id, isMust: true });
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("runMarketCron", () => {
  it("recorre a los usuarios y el body trae solo agregados", async () => {
    const result = await runMarketCron({ db: conn.db, logger });
    expect(result.ok).toBe(true);
    expect(result.body.ok).toBe(true);
    expect(result.body.users as number).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result.body)).not.toContain(USER);
  });
});
