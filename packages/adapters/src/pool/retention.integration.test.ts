import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POOL_RETENTION_DAYS, purgePool } from "./retention";

/** Ronda 37 · Retención del pool: 30 días desde la última vez que la fuente devolvió el aviso. */
const PREFIX = "retention-test-";
const USER = "a0000000-0000-4000-8000-0000000000c3";
const NOW = new Date("2026-10-12T12:00:00Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function blob(kind: string, userId: string | null = null): Promise<string> {
  const [b] = await conn.db
    .insert(s.rawBlobs)
    .values({ userId, kind, contentType: "application/json", body: "{}", bytes: 2 })
    .returning({ id: s.rawBlobs.id });
  return b!.id;
}

async function poolJob(
  id: string,
  lastSeenAt: Date,
  over: Partial<typeof s.publicJobs.$inferInsert> = {},
) {
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${id}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${id}`,
      title: "Backend Developer",
      titleNormalized: "backend developer",
      companyRaw: "Empresa Ficticia 1",
      companyNormalized: "empresa ficticia 1",
      firstSeenAt: ago(40 * DAY),
      lastSeenAt,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
}

const exists = async (id: string) =>
  (await conn.db.select({ id: s.publicJobs.id }).from(s.publicJobs).where(eq(s.publicJobs.id, id)))
    .length === 1;
const blobExists = async (id: string) =>
  (await conn.db.select({ id: s.rawBlobs.id }).from(s.rawBlobs).where(eq(s.rawBlobs.id, id)))
    .length === 1;

async function cleanup() {
  await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER));
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await conn.db.delete(s.rawBlobs).where(like(s.rawBlobs.kind, "pool\\_retention\\_test%"));
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
  await cleanup();
}, 180_000);

afterAll(async () => {
  if (conn) {
    await cleanup();
    await conn.close();
  }
  await container?.stop();
});

describe("purgePool", () => {
  it("borra solo lo que superó los 30 días desde la última vez visto (bordes)", async () => {
    expect(POOL_RETENTION_DAYS).toBe(30);
    const keepRef = await blob("pool_retention_test");
    const dropRef = await blob("pool_retention_test");
    const keep = await poolJob("keep", ago(29 * DAY + 23 * HOUR), { rawRef: `pg:${keepRef}` });
    const drop = await poolJob("drop", ago(30 * DAY + MIN), { rawRef: `pg:${dropRef}` });

    const out = await purgePool(conn.db, { now: NOW });
    expect(out.jobs).toBeGreaterThanOrEqual(1);
    expect(out.blobs).toBeGreaterThanOrEqual(1);
    expect(await exists(keep)).toBe(true);
    expect(await exists(drop)).toBe(false);
    expect(await blobExists(keepRef)).toBe(true);
    expect(await blobExists(dropRef)).toBe(false);
  });

  it("no toca crudos de usuarios ni de otro tipo aunque el aviso se purgue", async () => {
    const userBlob = await blob("pool_retention_test_user", USER);
    const otherKind = await blob("ingest_remoteok");
    const a = await poolJob("user-blob", ago(31 * DAY), { rawRef: `pg:${userBlob}` });
    const b = await poolJob("other-kind", ago(31 * DAY), { rawRef: `pg:${otherKind}` });
    await purgePool(conn.db, { now: NOW });
    expect(await exists(a)).toBe(false);
    expect(await exists(b)).toBe(false);
    expect(await blobExists(userBlob)).toBe(true);
    expect(await blobExists(otherKind)).toBe(true);
    await conn.db.delete(s.rawBlobs).where(inArray(s.rawBlobs.id, [userBlob, otherKind]));
  });

  it("una copia cuya raíz se purga queda como raíz", async () => {
    const root = await poolJob("root", ago(31 * DAY));
    const copy = await poolJob("copy", ago(1 * DAY), { dedupOfId: root });
    await purgePool(conn.db, { now: NOW });
    expect(await exists(root)).toBe(false);
    const [row] = await conn.db
      .select({ dedupOfId: s.publicJobs.dedupOfId })
      .from(s.publicJobs)
      .where(eq(s.publicJobs.id, copy));
    expect(row!.dedupOfId).toBeNull();
  });

  it("un jobs que apuntaba al aviso purgado queda intacto con public_job_id null", async () => {
    const pj = await poolJob("assigned", ago(45 * DAY));
    const [job] = await conn.db
      .insert(s.jobs)
      .values({
        userId: USER,
        companyRaw: "Empresa Ficticia 1",
        title: "Backend Developer",
        titleNormalized: "backend developer",
        publicJobId: pj,
      })
      .returning({ id: s.jobs.id });
    await purgePool(conn.db, { now: NOW });
    expect(await exists(pj)).toBe(false);
    const [after] = await conn.db
      .select({ title: s.jobs.title, publicJobId: s.jobs.publicJobId })
      .from(s.jobs)
      .where(eq(s.jobs.id, job!.id));
    expect(after).toEqual({ title: "Backend Developer", publicJobId: null });
  });

  it("borra public_job_skills en cascada y respeta days", async () => {
    const [skill] = await conn.db
      .insert(s.skills)
      .values({ slug: "pool_retention_skill", name: "Retention skill", category: "otra" })
      .onConflictDoUpdate({ target: s.skills.slug, set: { name: "Retention skill" } })
      .returning({ id: s.skills.id });
    const pj = await poolJob("cascade", ago(10 * DAY));
    await conn.db
      .insert(s.publicJobSkills)
      .values({ publicJobId: pj, skillId: skill!.id, isMust: true });
    await purgePool(conn.db, { now: NOW });
    expect(await exists(pj)).toBe(true); // con 30 días no se borra
    await purgePool(conn.db, { now: NOW, days: 7 });
    expect(await exists(pj)).toBe(false);
    const left = await conn.db
      .select({ id: s.publicJobSkills.publicJobId })
      .from(s.publicJobSkills)
      .where(eq(s.publicJobSkills.skillId, skill!.id));
    expect(left).toHaveLength(0);
    await conn.db.delete(s.skills).where(eq(s.skills.id, skill!.id));
  });
});
