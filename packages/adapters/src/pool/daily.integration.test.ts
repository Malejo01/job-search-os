import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { planDef, POOL_LIMIT_DEFAULTS, type PoolLimits } from "@job-search-os/pipeline";
import { and, eq, inArray, isNotNull, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assignPoolToUser } from "./assign";
import { enqueueUnevaluated } from "./backlog";
import { assignPoolDaily } from "./daily";

/**
 * Ronda 38 · Asignación diaria del pool: tope por ventana de 24 h, tope de evaluaciones por
 * usuario con override en el perfil, y aislamiento de errores. Datos inventados.
 */
const USER_BAD = "a0000000-0000-4000-8000-000000000001"; // criterios rotos; ordena primero
const USER_A = "a0000000-0000-4000-8000-0000000000a1";
const USER_B = "a0000000-0000-4000-8000-0000000000b2";
const GOOD = [USER_A, USER_B];
const PREFIX = "daily-test-";
const logger = pino({ level: "silent" });
const LIMITS: PoolLimits = { ...POOL_LIMIT_DEFAULTS, dailyAssignLimit: 3, dailyEvalPerUser: 2 };

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let seq = 0;

async function pool() {
  const n = ++seq;
  await conn.db.insert(s.publicJobs).values({
    sourceKind: "remoteok",
    externalId: `${PREFIX}${n}`,
    sourceName: "Remote OK",
    sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
    canonicalUrl: `https://example.com/jobs/${PREFIX}${n}`,
    title: "QA Engineer",
    titleNormalized: "qa engineer",
    companyRaw: `Empresa Ficticia ${n}`,
    companyNormalized: `empresa ficticia ${n}`,
    modality: "remoto",
    jdText: `Descripcion ficticia numero ${n} del puesto, solo para pruebas de asignacion.`,
    jdHash: `${PREFIX}hash-${n}`,
    roleHints: ["qa"],
    postedAt: new Date(Date.now() - n * 60_000),
    firstSeenAt: new Date(Date.now() - 3_600_000),
    lastSeenAt: new Date(),
  });
}

async function poolJobsOf(userId: string) {
  return conn.db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(and(eq(s.jobs.userId, userId), isNotNull(s.jobs.publicJobId)));
}

async function queuedFor(userId: string) {
  return conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.userId, userId));
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
    [USER_A, "a1"],
    [USER_B, "b2"],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Test",
        locationCountry: "AR",
        remoteOnly: true,
        targetRole: "qa",
        targetRoles: ["qa"],
        inboundAddress: `u_${tag}@ingest.test`,
      })
      .onConflictDoNothing();
    await conn.db
      .insert(s.evaluationCriteria)
      .values({ userId, version: 1, active: true, rules: criteria as never })
      .onConflictDoNothing();
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

async function addBadUser() {
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER_BAD,
      displayName: "Test",
      locationCountry: "AR",
      targetRole: "qa",
      targetRoles: ["qa"],
      inboundAddress: "u_bad@ingest.test",
    })
    .onConflictDoNothing();
  // Reglas sin la forma esperada: el prefiltro falla con este usuario
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER_BAD, version: 1, active: true, rules: {} as never })
    .onConflictDoNothing();
}

async function removeBadUser() {
  await conn.db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, USER_BAD));
  await conn.db.delete(s.profiles).where(eq(s.profiles.userId, USER_BAD));
}

beforeEach(async () => {
  await removeBadUser();
  for (const userId of GOOD) {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.userId, userId));
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
    await conn.db
      .update(s.profiles)
      .set({ poolDailyEvalLimit: null })
      .where(eq(s.profiles.userId, userId));
  }
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  for (let i = 0; i < 6; i++) await pool();
});

describe("assignPoolDaily", () => {
  it("respeta el tope diario en dos corridas seguidas", async () => {
    const first = await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(first).toEqual({
      users: 2,
      assigned: 6,
      enqueued: 4,
      discarded: 0,
      errors: 0,
      stopped: false,
    });
    expect(await poolJobsOf(USER_A)).toHaveLength(3);
    expect(await queuedFor(USER_A)).toHaveLength(2);

    // Misma ventana de 24 h: el tope ya está agotado, no se asigna ni se encola nada más
    const second = await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(second).toMatchObject({ users: 0, assigned: 0, enqueued: 0, errors: 0 });
    expect(await poolJobsOf(USER_A)).toHaveLength(3);
    expect(await poolJobsOf(USER_B)).toHaveLength(3);
    expect(await queuedFor(USER_B)).toHaveLength(2);
  });

  it("pasadas las 24 h el tope se renueva", async () => {
    await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    const tomorrow = new Date(Date.now() + 25 * 3_600_000);
    // Los avisos del pool "se ven" mañana también: la ventana de 14 días sigue abierta
    const r = await assignPoolDaily(conn.db, { logger, limits: LIMITS, now: () => tomorrow });
    expect(r.assigned).toBe(6);
    expect(await poolJobsOf(USER_A)).toHaveLength(6);
  });

  it("pool_daily_eval_limit del perfil pisa el default", async () => {
    await conn.db
      .update(s.profiles)
      .set({ poolDailyEvalLimit: 1 })
      .where(eq(s.profiles.userId, USER_A));
    const r = await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(r.assigned).toBe(6);
    expect(await queuedFor(USER_A)).toHaveLength(1);
    expect(await queuedFor(USER_B)).toHaveLength(2);
  });

  it("pool_daily_eval_limit en 0 asigna pero no encola", async () => {
    await conn.db
      .update(s.profiles)
      .set({ poolDailyEvalLimit: 0 })
      .where(eq(s.profiles.userId, USER_A));
    await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(await poolJobsOf(USER_A)).toHaveLength(3);
    expect(await queuedFor(USER_A)).toHaveLength(0);
  });

  it("con PRICING_ENABLED rige el tope del plan; apagado, el de siempre (C-11b)", async () => {
    // Plan vencido: rige el gratis. Las conexiones de test son del dueño: el trigger lo deja.
    await conn.db
      .update(s.profiles)
      .set({ plan: "fundador", planUntil: new Date(Date.now() - 3_600_000) })
      .where(eq(s.profiles.userId, USER_A));
    try {
      const freeCap = planDef("gratis").limits.evaluationsPerDay;
      await assignPoolDaily(conn.db, { logger, limits: LIMITS, env: { PRICING_ENABLED: "1" } });
      expect(await queuedFor(USER_A)).toHaveLength(Math.min(3, freeCap));
      // USER_B, sin plan pago y con los precios encendidos: también el gratis
      expect(await queuedFor(USER_B)).toHaveLength(Math.min(3, freeCap));
    } finally {
      await conn.db
        .update(s.profiles)
        .set({ plan: "gratis", planUntil: null })
        .where(eq(s.profiles.userId, USER_A));
    }
  });

  it("con PRICING_ENABLED apagado, un plan pago no cambia el tope", async () => {
    await conn.db.update(s.profiles).set({ plan: "fundador" }).where(eq(s.profiles.userId, USER_A));
    try {
      await assignPoolDaily(conn.db, { logger, limits: LIMITS, env: {} });
      expect(await queuedFor(USER_A)).toHaveLength(LIMITS.dailyEvalPerUser);
    } finally {
      await conn.db.update(s.profiles).set({ plan: "gratis" }).where(eq(s.profiles.userId, USER_A));
    }
  });

  it("un usuario que falla no corta a los demás", async () => {
    await addBadUser();
    const r = await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(r.errors).toBe(1);
    expect(r.assigned).toBe(6);
    expect(await poolJobsOf(USER_A)).toHaveLength(3);
    expect(await poolJobsOf(USER_B)).toHaveLength(3);
    expect(await poolJobsOf(USER_BAD)).toHaveLength(0);
  });

  it("el presupuesto de tiempo corta antes de empezar con el siguiente usuario", async () => {
    let t = 0;
    const clock = () => {
      const v = t;
      t += 10;
      return v;
    };
    // start = 0; antes del primer usuario 10 < 15; antes del segundo 20 >= 15
    const r = await assignPoolDaily(conn.db, { logger, limits: LIMITS, budgetMs: 15, clock });
    expect(r.stopped).toBe(true);
    expect(r.users).toBe(1);
    expect(await poolJobsOf(USER_A)).toHaveLength(3);
    expect(await poolJobsOf(USER_B)).toHaveLength(0);
  });

  it("con el tope de asignación agotado igual encola lo asignado y sin evaluar, por pre-score", async () => {
    // 3 asignadas sin encolar; la tercera tiene mejor pre-score por una skill propia
    const [skill] = await conn.db
      .insert(s.skills)
      .values({ slug: "daily_test_skill", name: "Skill de prueba", category: "otra" })
      .onConflictDoUpdate({ target: s.skills.slug, set: { name: "Skill de prueba" } })
      .returning({ id: s.skills.id });
    await conn.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, USER_A));
    await conn.db.insert(s.skillLevels).values({
      userId: USER_A,
      skillId: skill!.id,
      level: 3,
      confidence: 1,
      state: "respaldada",
    });
    const pjs = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));
    await conn.db
      .insert(s.publicJobSkills)
      .values({ publicJobId: pjs[5]!.id, skillId: skill!.id, isMust: true });
    await assignPoolToUser(conn.db, USER_A, { limit: 6, enqueueTop: 0, logger });
    expect(await poolJobsOf(USER_A)).toHaveLength(6);
    expect(await queuedFor(USER_A)).toHaveLength(0);
    const best = (
      await conn.db
        .select({ id: s.jobs.id })
        .from(s.jobs)
        .where(and(eq(s.jobs.userId, USER_A), eq(s.jobs.publicJobId, pjs[5]!.id)))
    )[0]!.id;

    // Una ya evaluada queda afuera
    const rows = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    const evaluated = rows.find((j) => j.id !== best)!;
    await conn.db.insert(s.evaluations).values({
      jobId: evaluated.id,
      userId: USER_A,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@test",
      model: "modelo-falso",
      hadFullJd: true,
      score: 5,
      locationOk: "ok",
      modality: "remoto",
      discipline: "otra",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "prueba",
      accion: "guardar",
    });

    // Tope de asignación agotado (3 de 3 en 24 h con límite 3), cola del día: 2
    const r = await assignPoolDaily(conn.db, {
      logger,
      limits: { ...LIMITS, dailyAssignLimit: 3 },
    });
    // A no recibe ofertas nuevas (B sí: es su primer día)
    expect(r).toMatchObject({ assigned: 3, errors: 0 });
    expect(await poolJobsOf(USER_A)).toHaveLength(6);
    const queued = (await queuedFor(USER_A)).map((m) => (m.payload as { jobId: string }).jobId);
    expect(queued).toHaveLength(2);
    expect(queued).toContain(best);
    expect(queued).not.toContain(evaluated.id);

    // Segunda corrida: ya está el tope de cola del día, no encola más
    await assignPoolDaily(conn.db, { logger, limits: { ...LIMITS, dailyAssignLimit: 3 } });
    expect(await queuedFor(USER_A)).toHaveLength(2);
  });

  it("la cola diaria no encola lo asignado que solo habilita otros países ni lo Staff", async () => {
    await assignPoolToUser(conn.db, USER_A, { limit: 6, enqueueTop: 0, logger });
    const rows = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    expect(rows).toHaveLength(6);
    // Dos solo para EE.UU., una Staff (la persona tiene años del perfil < 5) y tres normales
    const [us1, us2, staff] = rows;
    await conn.db
      .update(s.jobs)
      .set({ locationRaw: "Remote - US" })
      .where(inArray(s.jobs.id, [us1!.id, us2!.id]));
    await conn.db
      .update(s.jobs)
      .set({ title: "Staff QA Engineer" })
      .where(eq(s.jobs.id, staff!.id));
    await conn.db.update(s.profiles).set({ yearsTotal: 2 }).where(eq(s.profiles.userId, USER_A));
    try {
      const r = await enqueueUnevaluated(conn.db, USER_A, { count: 6, logger });
      expect(r.enqueued).toBe(3);
      expect(r.enqueuedJobIds).not.toContain(us1!.id);
      expect(r.enqueuedJobIds).not.toContain(us2!.id);
      expect(r.enqueuedJobIds).not.toContain(staff!.id);
    } finally {
      await conn.db
        .update(s.profiles)
        .set({ yearsTotal: null })
        .where(eq(s.profiles.userId, USER_A));
    }
  });

  it("más descartables que el tope de la consulta: pagina y encola la válida", async () => {
    await assignPoolToUser(conn.db, USER_A, { limit: 6, enqueueTop: 0, logger });
    const rows = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    expect(rows).toHaveLength(6);
    const [valid, ...rest] = rows;
    // Cinco solo para EE.UU. y una válida, con páginas de 2: una sola página no alcanza
    await conn.db
      .update(s.jobs)
      .set({ locationRaw: "Remote - US" })
      .where(
        inArray(
          s.jobs.id,
          rest.map((r) => r.id),
        ),
      );
    const r = await enqueueUnevaluated(conn.db, USER_A, {
      count: 6,
      logger,
      candidateCap: 2,
      maxPages: 10,
    });
    expect(r.enqueuedJobIds).toEqual([valid!.id]);
    // Con el tope duro de páginas en 1 no sigue buscando (y no se cuelga)
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.userId, USER_A));
    const capped = await enqueueUnevaluated(conn.db, USER_A, {
      count: 6,
      logger,
      candidateCap: 2,
      maxPages: 1,
    });
    expect(capped.enqueued).toBeLessThanOrEqual(1);
  });

  it("users cuenta solo a quienes se les asignó o encoló algo", async () => {
    await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
    const r = await assignPoolDaily(conn.db, { logger, limits: LIMITS });
    expect(r).toMatchObject({ users: 0, assigned: 0, enqueued: 0, errors: 0 });
  });

  it("con los topes en 0 no hace nada", async () => {
    const r = await assignPoolDaily(conn.db, {
      logger,
      limits: { ...LIMITS, dailyAssignLimit: 0, dailyEvalPerUser: 0 },
    });
    expect(r).toMatchObject({ users: 0, assigned: 0, enqueued: 0 });
  });
});
