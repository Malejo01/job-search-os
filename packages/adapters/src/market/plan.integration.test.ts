import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildLearningPlan, MIN_OWN_JOBS_FOR_PLAN } from "./plan";

/**
 * Ronda 38 · Plan de formación con respaldo del rol: con menos de 10 ofertas con skills y un rol
 * válido, la demanda sale de role_market_snapshots. Datos inventados.
 */
const USER = "a0000000-0000-4000-8000-0000000000a1";
const ROLE_WEEK = "2026-10-12";
const USER_WEEK = "2026-10-05";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
const skillIds: Record<string, string> = {};

async function setRole(...targetRoles: string[]) {
  await conn.db
    .update(s.profiles)
    .set({ targetRole: targetRoles[0] ?? null, targetRoles })
    .where(eq(s.profiles.userId, USER));
}

async function seedRoleMarket() {
  await conn.db.insert(s.roleMarketSnapshots).values([
    {
      role: "qa",
      weekStart: ROLE_WEEK,
      skillId: skillIds.plan_s1!,
      mentions: 5,
      mustMentions: 2,
      jobs: 8,
    },
    {
      role: "qa",
      weekStart: ROLE_WEEK,
      skillId: skillIds.plan_s2!,
      mentions: 1,
      mustMentions: 0,
      jobs: 8,
    },
  ]);
}

/** Snapshot propio del usuario con una sola skill distinta (plan_s3), para distinguir el origen. */
async function seedOwn(jobsWithSkills: number) {
  for (let i = 0; i < jobsWithSkills; i++) {
    const [job] = await conn.db
      .insert(s.jobs)
      .values({
        userId: USER,
        companyRaw: `Empresa Ficticia ${i}`,
        title: "QA Engineer",
        titleNormalized: "qa engineer",
      })
      .returning({ id: s.jobs.id });
    await conn.db
      .insert(s.jobSkills)
      .values({ jobId: job!.id, skillId: skillIds.plan_s3!, isMust: true });
  }
  await conn.db.insert(s.marketSnapshots).values({
    userId: USER,
    weekStart: USER_WEEK,
    skillId: skillIds.plan_s3!,
    mentions: jobsWithSkills,
    mustMentions: jobsWithSkills,
    weightedDemand: jobsWithSkills * 5,
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
  await applyMigrations(ownerUrl, { log: () => {} });
  conn = createDb(ownerUrl, { max: 2 });
  for (const slug of ["plan_s1", "plan_s2", "plan_s3"]) {
    const [k] = await conn.db
      .insert(s.skills)
      .values({ slug, name: `Skill ${slug}`, category: "otra" })
      .onConflictDoUpdate({ target: s.skills.slug, set: { name: `Skill ${slug}` } })
      .returning({ id: s.skills.id });
    skillIds[slug] = k!.id;
  }
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      inboundAddress: "u_a1@ingest.test",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  await conn.db.delete(s.learningPlanItems).where(eq(s.learningPlanItems.userId, USER));
  await conn.db.delete(s.marketSnapshots).where(eq(s.marketSnapshots.userId, USER));
  await conn.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, USER));
  await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER));
  await conn.db.delete(s.roleMarketSnapshots);
  await setRole("qa");
});

describe("buildLearningPlan · respaldo del rol", () => {
  it("con pocas ofertas y un rol válido, la demanda sale del rol", async () => {
    await seedRoleMarket();
    await seedOwn(2);
    const r = await buildLearningPlan(conn.db, { userId: USER, weekStart: USER_WEEK });
    expect(r.demandSource).toBe("rol");
    expect(r.weekStart).toBe(ROLE_WEEK);
    // weighted_demand = menciones + obligatorias: 7 y 1
    expect(r.rows.map((x) => [x.slug, x.weightedDemand])).toEqual([
      ["plan_s1", 7],
      ["plan_s2", 1],
    ]);
    expect(r.inserted).toBe(2);
    const items = await conn.db
      .select()
      .from(s.learningPlanItems)
      .where(eq(s.learningPlanItems.userId, USER));
    expect(items).toHaveLength(2);
  });

  it("sin ofertas propias ni snapshot, igual arma el plan del rol", async () => {
    await seedRoleMarket();
    const r = await buildLearningPlan(conn.db, { userId: USER });
    expect(r.demandSource).toBe("rol");
    expect(r.rows).toHaveLength(2);
  });

  it("el nivel propio baja la prioridad también con la demanda del rol", async () => {
    await seedRoleMarket();
    await conn.db.insert(s.skillLevels).values({
      userId: USER,
      skillId: skillIds.plan_s1!,
      level: 3,
      confidence: 1,
      state: "respaldada",
    });
    const r = await buildLearningPlan(conn.db, { userId: USER });
    // plan_s1 está en nivel 3: no queda nada por cerrar
    expect(r.rows.map((x) => x.slug)).toEqual(["plan_s2"]);
  });

  it("con 10 o más ofertas con skills usa la demanda del usuario", async () => {
    await seedRoleMarket();
    await seedOwn(MIN_OWN_JOBS_FOR_PLAN);
    const r = await buildLearningPlan(conn.db, { userId: USER, weekStart: USER_WEEK });
    expect(r.demandSource).toBe("usuario");
    expect(r.weekStart).toBe(USER_WEEK);
    expect(r.rows.map((x) => x.slug)).toEqual(["plan_s3"]);
  });

  it("con 9 ofertas todavía rige el respaldo", async () => {
    await seedRoleMarket();
    await seedOwn(MIN_OWN_JOBS_FOR_PLAN - 1);
    const r = await buildLearningPlan(conn.db, { userId: USER, weekStart: USER_WEEK });
    expect(r.demandSource).toBe("rol");
  });

  it("sin rol y con pocas ofertas: como antes, con el snapshot del usuario", async () => {
    await setRole();
    await seedRoleMarket();
    await seedOwn(2);
    const r = await buildLearningPlan(conn.db, { userId: USER, weekStart: USER_WEEK });
    expect(r.demandSource).toBe("usuario");
    expect(r.rows.map((x) => x.slug)).toEqual(["plan_s3"]);
  });

  it("sin rol, sin ofertas y sin snapshot: plan vacío", async () => {
    await setRole();
    expect(await buildLearningPlan(conn.db, { userId: USER })).toEqual({
      weekStart: null,
      rows: [],
      inserted: 0,
      updated: 0,
      removed: 0,
      demandSource: "usuario",
    });
  });

  it("rol válido pero sin datos del rol en el pool: usa el snapshot del usuario", async () => {
    await seedOwn(2);
    const r = await buildLearningPlan(conn.db, { userId: USER, weekStart: USER_WEEK });
    expect(r.demandSource).toBe("usuario");
    expect(r.rows.map((x) => x.slug)).toEqual(["plan_s3"]);
  });

  it("con varios puestos, role elige la demanda y por defecto rige el principal", async () => {
    await seedRoleMarket();
    await conn.db.insert(s.roleMarketSnapshots).values({
      role: "ux_ui",
      weekStart: ROLE_WEEK,
      skillId: skillIds.plan_s3!,
      mentions: 4,
      mustMentions: 1,
      jobs: 6,
    });
    await setRole("qa", "ux_ui");
    const porDefecto = await buildLearningPlan(conn.db, { userId: USER });
    expect(porDefecto.rows.map((x) => x.slug)).toEqual(["plan_s1", "plan_s2"]);
    const segundo = await buildLearningPlan(conn.db, { userId: USER, role: "ux_ui" });
    expect(segundo.demandSource).toBe("rol");
    expect(segundo.rows.map((x) => x.slug)).toEqual(["plan_s3"]);
    // un puesto que la persona no eligió no se usa: cae al principal
    const ajeno = await buildLearningPlan(conn.db, { userId: USER, role: "backend" });
    expect(ajeno.rows.map((x) => x.slug)).toEqual(["plan_s1", "plan_s2"]);
  });

  it("un rol inválido no activa el respaldo", async () => {
    await setRole("no_es_un_rol");
    await seedRoleMarket();
    const r = await buildLearningPlan(conn.db, { userId: USER });
    expect(r.demandSource).toBe("usuario");
    expect(r.weekStart).toBeNull();
  });
});
