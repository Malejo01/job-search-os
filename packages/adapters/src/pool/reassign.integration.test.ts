import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { eq, inArray, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assignPoolToUser } from "./assign";
import { hasPoolEvaluationActivity, loadPoolEvalLimit } from "./usage";

/**
 * Ronda 41 · Reasignación del pool (replaceUntouched) y actividad de evaluación. Sin red ni LLM;
 * avisos inventados (Empresa Ficticia N, example.com). Corre como dueño, igual que el servicio.
 */
const USER_A = "a0000000-0000-4000-8000-0000000000d1"; // puesto: qa
const USER_B = "a0000000-0000-4000-8000-0000000000e2"; // puesto: qa
const USER_NO_RULES = "a0000000-0000-4000-8000-0000000000f3";
const USERS = [USER_A, USER_B, USER_NO_RULES];
const PREFIX = "reassign-test-";
const SKILL_SLUG = "reassign_test_skill";
const logger = pino({ level: "silent" });

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let skillId: string;
let seq = 0;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

type PoolInsert = typeof s.publicJobs.$inferInsert;
type AssignOverrides = Partial<Parameters<typeof assignPoolToUser>[2]>;

const run = (userId: string, over: AssignOverrides = {}) =>
  assignPoolToUser(conn.db, userId, {
    limit: 20,
    enqueueTop: 0,
    replaceUntouched: true,
    logger,
    ...over,
  });

async function pool(over: Partial<PoolInsert> = {}, skillMust?: boolean) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}?ref=pool`,
      canonicalUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: "QA Engineer",
      titleNormalized: "qa engineer",
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      modality: "remoto",
      jdText: `Descripcion ficticia numero ${n} del puesto, solo para pruebas de reasignacion.`,
      jdHash: `${PREFIX}hash-${n}`,
      roleHints: ["qa"],
      postedAt: minutesAgo(n),
      firstSeenAt: minutesAgo(60),
      lastSeenAt: new Date(),
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  if (skillMust !== undefined) {
    await conn.db
      .insert(s.publicJobSkills)
      .values({ publicJobId: row!.id, skillId, isMust: skillMust, rawMention: "jd" });
  }
  return row!.id;
}

/** Una oferta ya asignada a la persona, en el estado que pida el caso. */
async function owned(
  userId: string,
  publicJobId: string,
  status: (typeof s.jobs.$inferInsert)["status"] = "prefiltrada",
) {
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      companyRaw: "Empresa Ficticia Z",
      title: "QA Engineer",
      titleNormalized: "qa engineer",
      canonicalUrl: `https://example.com/jobs/${PREFIX}own-${publicJobId}`,
      publicJobId,
      status,
    })
    .returning({ id: s.jobs.id });
  return job!.id;
}

async function evaluate(userId: string, jobId: string) {
  await conn.db.insert(s.evaluations).values({
    jobId,
    userId,
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
}

async function queue(userId: string, jobId: string, status: string) {
  await conn.db
    .insert(s.jobQueue)
    .values({ queue: "evaluate_job", userId, payload: { jobId }, status });
}

async function publicIdsOf(userId: string): Promise<string[]> {
  const rows = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, userId));
  return rows.map((j) => j.publicJobId ?? "").sort();
}

async function jobIdsOf(userId: string): Promise<string[]> {
  const rows = await conn.db
    .select({ id: s.jobs.id })
    .from(s.jobs)
    .where(eq(s.jobs.userId, userId));
  return rows.map((j) => j.id);
}

async function queuedOf(userId: string) {
  return conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.userId, userId));
}

/** `target_role` (principal) y `target_roles` siempre juntos, como los escribe la app. */
const rolesOf = (...targetRoles: string[]) => ({
  targetRole: targetRoles[0] ?? null,
  targetRoles,
});

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
  const [skill] = await conn.db
    .insert(s.skills)
    .values({ slug: SKILL_SLUG, name: "Skill de prueba", category: "otra" })
    .onConflictDoUpdate({ target: s.skills.slug, set: { name: "Skill de prueba" } })
    .returning({ id: s.skills.id });
  skillId = skill!.id;
  for (const [userId, tag] of [
    [USER_A, "d1"],
    [USER_B, "e2"],
    [USER_NO_RULES, "f3"],
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
    if (userId !== USER_NO_RULES) {
      await conn.db
        .insert(s.evaluationCriteria)
        .values({ userId, version: 1, active: true, rules: criteria as never })
        .onConflictDoNothing();
    }
  }
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  for (const userId of USERS) {
    await conn.db.delete(s.jobQueue).where(eq(s.jobQueue.userId, userId));
    await conn.db.delete(s.answerBank).where(eq(s.answerBank.userId, userId));
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
    await conn.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, userId));
  }
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await setProfile(USER_A, { ...rolesOf("qa"), poolDailyEvalLimit: null });
  await setProfile(USER_B, rolesOf("qa"));
});

describe("assignPoolToUser · replaceUntouched", () => {
  it("reemplaza las no tocadas y asigna de nuevo con las skills nuevas", async () => {
    await pool();
    await pool();
    const withSkill = await pool({ postedAt: minutesAgo(500) }, true);

    const first = await run(USER_A, { limit: 2, replaceUntouched: false });
    expect(first).toMatchObject({ assigned: 2, replaced: 0 });

    await conn.db
      .insert(s.skillLevels)
      .values({ userId: USER_A, skillId, level: 3, confidence: 1, state: "respaldada" });
    const second = await run(USER_A, { limit: 1 });
    expect(second).toMatchObject({ assigned: 1, replaced: 2 });
    expect(await publicIdsOf(USER_A)).toEqual([withSkill]);
  });

  it("no borra evaluadas, con mensaje en cola, con estado cambiado ni con referencias de usuario", async () => {
    const evaluated = await owned(USER_A, await pool());
    await evaluate(USER_A, evaluated);
    const pending = await owned(USER_A, await pool());
    await queue(USER_A, pending, "pending");
    const done = await owned(USER_A, await pool());
    await queue(USER_A, done, "done");
    const failed = await owned(USER_A, await pool());
    await queue(USER_A, failed, "failed");
    const changed = await owned(USER_A, await pool(), "descartada");
    const withApplication = await owned(USER_A, await pool());
    await conn.db.insert(s.applications).values({ jobId: withApplication, userId: USER_A });
    const withAnswers = await owned(USER_A, await pool());
    await conn.db
      .insert(s.applicationAnswers)
      .values({ userId: USER_A, jobId: withAnswers, position: 1, question: "P", answer: "R" });
    const inBank = await owned(USER_A, await pool());
    await conn.db.insert(s.answerBank).values({
      userId: USER_A,
      question: "P",
      questionNormalized: "p",
      answer: "R",
      lang: "es",
      sourceJobId: inBank,
    });
    const untouched = await owned(USER_A, await pool());
    const kept = [evaluated, pending, done, failed, changed, withApplication, withAnswers, inBank];

    const r = await run(USER_A);
    expect(r.replaced).toBe(1);
    const now = await jobIdsOf(USER_A);
    for (const id of kept) expect(now).toContain(id);
    expect(now).not.toContain(untouched);
    // La no tocada vuelve a asignarse desde el pool (nueva fila)
    expect(r.assigned).toBe(1);
  });

  it("no borra nada de otro usuario ni toca public_jobs", async () => {
    const pj = await pool();
    const mine = await owned(USER_A, pj);
    const theirs = await owned(USER_B, pj);
    const before = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));

    const r = await run(USER_A);
    expect(r.replaced).toBe(1);
    expect(await jobIdsOf(USER_B)).toEqual([theirs]);
    expect(await jobIdsOf(USER_A)).not.toContain(mine);
    const after = await conn.db
      .select({ id: s.publicJobs.id })
      .from(s.publicJobs)
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));
    expect(after).toHaveLength(before.length);
  });

  it("no borra una no tocada que es duplicate_of de otra oferta del usuario", async () => {
    const original = await owned(USER_A, await pool());
    const copy = await owned(USER_A, await pool(), "descartada");
    await conn.db.update(s.jobs).set({ duplicateOfId: original }).where(eq(s.jobs.id, copy));

    const r = await run(USER_A);
    expect(r.replaced).toBe(0);
    expect(await jobIdsOf(USER_A)).toEqual(expect.arrayContaining([original, copy]));
  });

  it("sin reglas activas no borra nada", async () => {
    const pj = await pool();
    const job = await owned(USER_NO_RULES, pj);
    const r = await run(USER_NO_RULES);
    expect(r).toMatchObject({ assigned: 0, replaced: 0 });
    expect(await jobIdsOf(USER_NO_RULES)).toEqual([job]);
  });

  it("sin candidatas después de borrar igual devuelve replaced", async () => {
    const stale = await pool({ lastSeenAt: minutesAgo(15 * 24 * 60) });
    await owned(USER_A, stale);
    const r = await run(USER_A);
    expect(r).toMatchObject({ assigned: 0, replaced: 1 });
    expect(await jobIdsOf(USER_A)).toHaveLength(0);
  });

  it("borra también job_sources y job_skills del job reemplazado", async () => {
    await pool({}, true);
    await run(USER_A, { replaceUntouched: false });
    const [job] = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    await conn.db
      .update(s.publicJobs)
      .set({ lastSeenAt: minutesAgo(15 * 24 * 60) })
      .where(like(s.publicJobs.externalId, `${PREFIX}%`));
    await run(USER_A);
    const sources = await conn.db
      .select()
      .from(s.jobSources)
      .where(inArray(s.jobSources.jobId, [job!.id]));
    const skills = await conn.db
      .select()
      .from(s.jobSkills)
      .where(inArray(s.jobSkills.jobId, [job!.id]));
    expect(sources).toHaveLength(0);
    expect(skills).toHaveLength(0);
  });
});

describe("assignPoolToUser · topes con reemplazo", () => {
  it("con deductLast24h y replaceUntouched el total en 24 h nunca supera limit", async () => {
    for (let i = 0; i < 10; i++) await pool();
    const call = () => run(USER_A, { limit: 4, enqueueTop: 2, deductLast24h: true });
    const first = await call();
    expect(first).toMatchObject({ assigned: 4, enqueued: 2, replaced: 0 });

    // Las 2 encoladas quedan (tocadas); las otras 2 se reemplazan y se reasignan
    const second = await call();
    expect(second).toMatchObject({ assigned: 2, enqueued: 0, replaced: 2 });
    expect(await jobIdsOf(USER_A)).toHaveLength(4);
    expect(await queuedOf(USER_A)).toHaveLength(2);

    const third = await call();
    expect(third).toMatchObject({ assigned: 2, enqueued: 0, replaced: 2 });
    expect(await jobIdsOf(USER_A)).toHaveLength(4);
  });

  it("dos reasignaciones en paralelo no pasan del tope", async () => {
    for (let i = 0; i < 10; i++) await pool();
    const call = () => run(USER_A, { limit: 4, enqueueTop: 2, deductLast24h: true });
    await Promise.all([call(), call()]);
    expect(await jobIdsOf(USER_A)).toHaveLength(4);
    expect(await queuedOf(USER_A)).toHaveLength(2);
  });
});

describe("assignPoolToUser · primera vez", () => {
  it("paso 1 sin encolar; la reasignación encola 9; una segunda no duplica", async () => {
    for (let i = 0; i < 12; i++) await pool();

    const step1 = await run(USER_A, {
      limit: 30,
      enqueueTop: 0,
      deductLast24h: true,
      replaceUntouched: false,
    });
    expect(step1).toMatchObject({ assigned: 12, enqueued: 0 });
    expect(await queuedOf(USER_A)).toHaveLength(0);
    expect(await hasPoolEvaluationActivity(conn.db, USER_A)).toBe(false);

    const reassign = () => run(USER_A, { limit: 30, enqueueTop: 9, deductLast24h: true });
    const first = await reassign();
    expect(first).toMatchObject({ assigned: 12, enqueued: 9, replaced: 12 });
    expect(await queuedOf(USER_A)).toHaveLength(9);
    expect(await hasPoolEvaluationActivity(conn.db, USER_A)).toBe(true);

    const second = await reassign();
    expect(second.enqueued).toBe(0);
    expect(await queuedOf(USER_A)).toHaveLength(9);
    expect(await jobIdsOf(USER_A)).toHaveLength(12);
  });
});

describe("assignPoolToUser · cambio de puesto", () => {
  it("de QA a UX: la evaluada se queda, las QA no tocadas se van y entran UX hasta el tope", async () => {
    await pool();
    await pool();
    await pool();
    const ux = [] as string[];
    for (let i = 0; i < 4; i++) {
      ux.push(
        await pool({ title: "UX Designer", titleNormalized: "ux designer", roleHints: ["ux_ui"] }),
      );
    }
    await run(USER_A, { replaceUntouched: false });
    expect(await jobIdsOf(USER_A)).toHaveLength(3);
    const [evaluatedJob] = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    await evaluate(USER_A, evaluatedJob!.id);

    await setProfile(USER_A, rolesOf("ux_ui"));
    const r = await run(USER_A, { limit: 20, enqueueTop: 5, deductLast24h: true });
    expect(r).toMatchObject({ replaced: 2, assigned: 4 });

    const ids = await publicIdsOf(USER_A);
    expect(ids).toContain(evaluatedJob!.publicJobId);
    for (const id of ux) expect(ids).toContain(id);
    expect(ids).toHaveLength(5);
    // El tope de encolado descuenta lo que había en la cola de 24 h (nada) y respeta enqueueTop
    expect(r.enqueued).toBeLessThanOrEqual(5);
  });

  it("de {QA} a {QA, UX} (ronda 45): se reasigna con los dos puestos y matched_role correcto", async () => {
    const qa = [await pool(), await pool(), await pool()];
    const ux = [] as string[];
    for (let i = 0; i < 4; i++) {
      ux.push(
        await pool({ title: "UX Designer", titleNormalized: "ux designer", roleHints: ["ux_ui"] }),
      );
    }
    await run(USER_A, { replaceUntouched: false });
    expect(await jobIdsOf(USER_A)).toHaveLength(3);
    const [evaluatedJob] = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    await evaluate(USER_A, evaluatedJob!.id);

    await setProfile(USER_A, rolesOf("qa", "ux_ui"));
    const r = await run(USER_A, { limit: 20, enqueueTop: 5, deductLast24h: true });
    expect(r).toMatchObject({ replaced: 2, assigned: 6 });

    const ids = await publicIdsOf(USER_A);
    for (const id of [...qa, ...ux]) expect(ids).toContain(id);
    const rows = await conn.db.select().from(s.jobs).where(eq(s.jobs.userId, USER_A));
    const roleOf = new Map(rows.map((j) => [j.publicJobId, j.matchedRole]));
    for (const id of ux) expect(roleOf.get(id)).toBe("ux_ui");
    // Las QA reasignadas se guardan con su puesto; la evaluada conserva el que tenía (null)
    const reassignedQa = qa.filter((id) => id !== evaluatedJob!.publicJobId);
    for (const id of reassignedQa) expect(roleOf.get(id)).toBe("qa");
  });
});

describe("hasPoolEvaluationActivity y loadPoolEvalLimit", () => {
  it("false sin actividad; true con un mensaje encolado", async () => {
    const job = await owned(USER_A, await pool());
    expect(await hasPoolEvaluationActivity(conn.db, USER_A)).toBe(false);
    await queue(USER_A, job, "done");
    expect(await hasPoolEvaluationActivity(conn.db, USER_A)).toBe(true);
    expect(await hasPoolEvaluationActivity(conn.db, USER_B)).toBe(false);
  });

  it("true con una evaluación", async () => {
    const job = await owned(USER_B, await pool());
    expect(await hasPoolEvaluationActivity(conn.db, USER_B)).toBe(false);
    await evaluate(USER_B, job);
    expect(await hasPoolEvaluationActivity(conn.db, USER_B)).toBe(true);
  });

  it("loadPoolEvalLimit devuelve el campo del perfil o null", async () => {
    expect(await loadPoolEvalLimit(conn.db, USER_A)).toBeNull();
    await setProfile(USER_A, { poolDailyEvalLimit: 4 });
    expect(await loadPoolEvalLimit(conn.db, USER_A)).toBe(4);
    await setProfile(USER_A, { poolDailyEvalLimit: 0 });
    expect(await loadPoolEvalLimit(conn.db, USER_A)).toBe(0);
  });
});
