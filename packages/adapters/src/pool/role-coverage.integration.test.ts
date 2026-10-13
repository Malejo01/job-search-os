import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { explainEmptyRoles } from "./role-coverage";

/**
 * Ronda 46 · Explicar el vacío por puesto. Sin red ni LLM; avisos inventados (Empresa Ficticia N,
 * example.com). Corre como dueño, igual que el servicio.
 */
const USER_A = "a0000000-0000-4000-8000-0000000000d4"; // ai_engineer
const USER_B = "a0000000-0000-4000-8000-0000000000e5"; // otro usuario con el mismo puesto
const USER_NONE = "a0000000-0000-4000-8000-0000000000f6"; // sin puestos
const USERS = [USER_A, USER_B, USER_NONE];
const PREFIX = "coverage-test-";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

const rules = { ...criteria, title_blocklist: ["senior", "head of"] } as never;

type PoolInsert = typeof s.publicJobs.$inferInsert;

async function pool(over: Partial<PoolInsert> = {}) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
      canonicalUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: "AI Engineer",
      titleNormalized: "ai engineer",
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      modality: "remoto",
      jdText: `Descripcion ficticia numero ${n} del puesto.`,
      jdHash: `${PREFIX}hash-${n}`,
      roleHints: ["ai_engineer"],
      postedAt: new Date(Date.now() - n * 60_000),
      firstSeenAt: new Date(Date.now() - 3_600_000),
      lastSeenAt: new Date(),
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
}

async function assignTo(userId: string, publicJobId: string, title = "AI Engineer") {
  await conn.db.insert(s.jobs).values({
    userId,
    companyRaw: "Empresa Ficticia X",
    title,
    titleNormalized: title.toLowerCase(),
    publicJobId,
    status: "prefiltrada",
    flags: [],
    firstSeenAt: new Date(),
  });
}

async function setProfile(userId: string, patch: Partial<typeof s.profiles.$inferInsert>) {
  await conn.db.update(s.profiles).set(patch).where(eq(s.profiles.userId, userId));
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
  for (const [userId, tag] of [
    [USER_A, "d4"],
    [USER_B, "e5"],
    [USER_NONE, "f6"],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Test",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: `u_${tag}@ingest.test`,
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId, version: 1, active: true, rules })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  for (const userId of USERS) await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await setProfile(USER_A, {
    targetRole: "ai_engineer",
    targetRoles: ["ai_engineer"],
    remoteOnly: true,
    locationCountry: "AR",
  });
  await setProfile(USER_B, {
    targetRole: "ai_engineer",
    targetRoles: ["ai_engineer"],
    remoteOnly: true,
    locationCountry: "AR",
  });
  await setProfile(USER_NONE, { targetRole: null, targetRoles: [] });
});

describe("explainEmptyRoles", () => {
  it("3 avisos Senior con blocklist: total 3, motivo blocklist", async () => {
    for (let i = 0; i < 3; i++) await pool({ title: `Senior AI Engineer ${i}` });
    const [gap, ...rest] = await explainEmptyRoles(conn.db, USER_A);
    expect(rest).toEqual([]);
    expect(gap).toMatchObject({
      role: "ai_engineer",
      label: "AI Engineer",
      total: 3,
      pending: 0,
      mainCause: "blocklist",
      groups: [{ key: "blocklist:senior", text: "piden Senior", count: 3 }],
    });
  });

  it("avisos híbridos con remote_only: no son remotas", async () => {
    await pool({ modality: "hibrido" });
    await pool({ modality: "hibrido" });
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap).toMatchObject({
      total: 2,
      mainCause: "modalidad",
      groups: [{ key: "modalidad", count: 2 }],
    });
  });

  it("avisos que pasan y no están asignados: pendientes", async () => {
    await pool();
    await pool();
    await pool({ title: "Senior AI Engineer" });
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap).toMatchObject({ total: 3, pending: 2, mainCause: "pendientes" });
    expect(gap!.groups).toEqual([{ key: "blocklist:senior", text: "piden Senior", count: 1 }]);
  });

  it("sin avisos del puesto en el pool", async () => {
    await pool({ roleHints: ["qa"] });
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap).toMatchObject({ total: 0, mainCause: "sin_avisos" });
  });

  it("fuera de la ventana no cuenta", async () => {
    await pool({ lastSeenAt: new Date(Date.now() - 20 * 24 * 3_600_000) });
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap!.total).toBe(0);
  });

  it("un puesto con una oferta ya asignada no aparece", async () => {
    const id = await pool();
    await pool({ title: "Senior AI Engineer" });
    await assignTo(USER_A, id);
    expect(await explainEmptyRoles(conn.db, USER_A)).toEqual([]);
  });

  it("lo que ya tiene por otra vía (misma URL) no cuenta", async () => {
    const id = await pool();
    await pool();
    // Misma URL pero cargada a mano: la persona ya la tiene, sin public_job_id
    const [pj] = await conn.db.select().from(s.publicJobs).where(eq(s.publicJobs.id, id));
    await conn.db.insert(s.jobs).values({
      userId: USER_A,
      companyRaw: "Empresa Ficticia X",
      title: "AI Engineer",
      titleNormalized: "ai engineer",
      canonicalUrl: pj!.canonicalUrl,
      status: "prefiltrada",
      flags: [],
      firstSeenAt: new Date(),
    });
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap!.total).toBe(1);
  });

  it("sin puestos devuelve []", async () => {
    await pool();
    expect(await explainEmptyRoles(conn.db, USER_NONE)).toEqual([]);
  });

  it("no lee nada de otro usuario", async () => {
    const id = await pool();
    // B tiene el puesto cubierto; A sigue vacío y ve el aviso en su total
    await assignTo(USER_B, id);
    expect(await explainEmptyRoles(conn.db, USER_B)).toEqual([]);
    const [gap] = await explainEmptyRoles(conn.db, USER_A);
    expect(gap!.total).toBe(1);
    expect(gap!.pending).toBe(1);
  });
});
