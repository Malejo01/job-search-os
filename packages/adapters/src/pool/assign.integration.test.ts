import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import { asc, eq, inArray, like } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assignPoolToUser } from "./assign";

/**
 * Ronda 38 · Asignación del pool a un usuario. Sin red ni LLM; avisos inventados (Empresa Ficticia N,
 * example.com). Corre como dueño, igual que el servicio.
 */
const USER_A = "a0000000-0000-4000-8000-0000000000a1"; // rol: qa
const USER_B = "a0000000-0000-4000-8000-0000000000b2"; // sin rol
const USER_NO_RULES = "a0000000-0000-4000-8000-0000000000c3";
const USER_AREAS = "a0000000-0000-4000-8000-0000000000d4"; // contaduría, solo «impuestos» (C5-3)
const USERS = [USER_A, USER_B, USER_NO_RULES, USER_AREAS];
const PREFIX = "assign-test-";
const SKILL_SLUG = "assign_test_skill";
const logger = pino({ level: "silent" });

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let skillId: string;
let seq = 0;

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);
const run = (userId: string, limit: number, enqueueTop: number) =>
  assignPoolToUser(conn.db, userId, { limit, enqueueTop, logger });

type PoolInsert = typeof s.publicJobs.$inferInsert;

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
      jdText: `Descripcion ficticia numero ${n} del puesto, solo para pruebas de asignacion.`,
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

async function jobsOf(userId: string) {
  return conn.db.select().from(s.jobs).where(eq(s.jobs.userId, userId));
}

async function publicIdsOf(jobIds: string[]): Promise<(string | null)[]> {
  if (!jobIds.length) return [];
  const rows = await conn.db
    .select({ id: s.jobs.id, publicJobId: s.jobs.publicJobId })
    .from(s.jobs)
    .where(inArray(s.jobs.id, jobIds));
  const byId = new Map(rows.map((r) => [r.id, r.publicJobId]));
  return jobIds.map((id) => byId.get(id) ?? null);
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
    [USER_A, "a1"],
    [USER_B, "b2"],
    [USER_NO_RULES, "c3"],
    [USER_AREAS, "d4"],
  ] as const) {
    await conn.db
      .insert(s.profiles)
      .values({
        userId,
        displayName: "Test",
        locationCountry: "AR",
        remoteOnly: true,
        inboundAddress: `u_${tag}@ingest.test`,
        ...(userId === USER_AREAS
          ? {
              ...rolesOf("finanzas_contabilidad"),
              targetSpecialties: { finanzas_contabilidad: ["impuestos"] },
            }
          : {}),
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
    await conn.db.delete(s.jobs).where(eq(s.jobs.userId, userId));
    await conn.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, userId));
  }
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
  await setProfile(USER_A, { ...rolesOf("qa"), remoteOnly: true, locationCountry: "AR" });
  await setProfile(USER_B, { ...rolesOf(), remoteOnly: true, locationCountry: "AR" });
});

describe("assignPoolToUser · selección", () => {
  it("con rol: el QA recibe QA y avisos sin señal de rol, no los de UX", async () => {
    const qa = await pool({ roleHints: ["qa"] });
    const open = await pool({ roleHints: [] });
    await pool({ title: "UX Designer", titleNormalized: "ux designer", roleHints: ["ux_ui"] });

    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 2, discarded: 0, alreadyHad: 0, enqueued: 0 });
    const got = (await jobsOf(USER_A)).map((j) => j.publicJobId).sort();
    expect(got).toEqual([qa, open].sort());
  });

  it("sin rol guardado: sin filtro, recibe todos", async () => {
    await pool({ roleHints: ["qa"] });
    await pool({ roleHints: [] });
    await pool({ title: "UX Designer", titleNormalized: "ux designer", roleHints: ["ux_ui"] });
    const r = await run(USER_B, 10, 0);
    expect(r.assigned).toBe(3);
  });

  it("un puesto inválido en target_roles cuenta como sin rol", async () => {
    await setProfile(USER_A, rolesOf("no_es_un_rol"));
    await pool({ roleHints: ["ux_ui"] });
    expect((await run(USER_A, 10, 0)).assigned).toBe(1);
  });

  it("target_roles vacío con target_role viejo: se lee solo la lista (sin rol)", async () => {
    await setProfile(USER_A, { targetRole: "qa", targetRoles: [] });
    await pool({ roleHints: ["ux_ui"] });
    expect((await run(USER_A, 10, 0)).assigned).toBe(1);
  });

  describe("varios puestos (ronda 45)", () => {
    it("dos puestos: reparte intercalado, guarda matched_role y deja afuera un tercer puesto", async () => {
      await setProfile(USER_A, rolesOf("qa", "ux_ui"));
      const q = [] as string[];
      const u = [] as string[];
      for (let i = 0; i < 3; i++) q.push(await pool({ roleHints: ["qa"] }));
      for (let i = 0; i < 3; i++) {
        u.push(
          await pool({
            title: "UX Designer",
            titleNormalized: "ux designer",
            roleHints: ["ux_ui"],
          }),
        );
      }
      await pool({
        title: "Backend Developer",
        titleNormalized: "backend developer",
        roleHints: ["backend"],
      });
      const open = await pool({ roleHints: [] });

      const r = await run(USER_A, 10, 10);
      expect(r.assigned).toBe(7);
      const order = await publicIdsOf(r.enqueuedJobIds);
      // intercalado A, B, A, B...; la oferta sin señal al final. Dentro de cada puesto, el orden de rankCandidates
      // (mismo score: más nueva primero, y pool() las numera de más nueva a más vieja).
      expect(order).toEqual([q[0], u[0], q[1], u[1], q[2], u[2], open]);
      const byPublic = new Map((await jobsOf(USER_A)).map((j) => [j.publicJobId, j.matchedRole]));
      expect(q.map((id) => byPublic.get(id))).toEqual(["qa", "qa", "qa"]);
      expect(u.map((id) => byPublic.get(id))).toEqual(["ux_ui", "ux_ui", "ux_ui"]);
      expect(byPublic.get(open)).toBeNull();
    });

    it("el tope reparte por el intercalado: con límite 4, dos de cada puesto", async () => {
      await setProfile(USER_A, rolesOf("qa", "ux_ui"));
      for (let i = 0; i < 4; i++) await pool({ roleHints: ["qa"] });
      for (let i = 0; i < 4; i++) {
        await pool({ title: "UX Designer", titleNormalized: "ux designer", roleHints: ["ux_ui"] });
      }
      expect((await run(USER_A, 4, 0)).assigned).toBe(4);
      const roles = (await jobsOf(USER_A)).map((j) => j.matchedRole).sort();
      expect(roles).toEqual(["qa", "qa", "ux_ui", "ux_ui"]);
    });

    it("un solo puesto: matched_role es ese puesto y el orden es el de siempre", async () => {
      const a = await pool({ roleHints: ["qa"] });
      const open = await pool({ roleHints: [] });
      const r = await run(USER_A, 10, 10);
      expect(await publicIdsOf(r.enqueuedJobIds)).toEqual([a, open]);
      const byPublic = new Map((await jobsOf(USER_A)).map((j) => [j.publicJobId, j.matchedRole]));
      expect(byPublic.get(a)).toBe("qa");
      expect(byPublic.get(open)).toBeNull();
    });

    it("sin puestos, matched_role queda null", async () => {
      await pool({ roleHints: ["qa"] });
      await run(USER_B, 10, 0);
      expect((await jobsOf(USER_B)).map((j) => j.matchedRole)).toEqual([null]);
    });
  });

  it("respeta el límite y el orden: rol exacto antes que sin hints, después pre-score", async () => {
    await conn.db
      .insert(s.skillLevels)
      .values({ userId: USER_A, skillId, level: 3, confidence: 1, state: "respaldada" });
    // score 9 con la skill propia; 5 sin skills mapeadas
    const exactHigh = await pool({ roleHints: ["qa"] }, true);
    const exactLow = await pool({ roleHints: ["qa"] });
    const openHigh = await pool({ roleHints: [] }, true);

    const two = await run(USER_A, 2, 5);
    expect(two.assigned).toBe(2);
    expect(await publicIdsOf(two.enqueuedJobIds)).toEqual([exactHigh, exactLow]);

    const rest = await run(USER_A, 5, 5);
    expect(rest.assigned).toBe(1);
    expect(await publicIdsOf(rest.enqueuedJobIds)).toEqual([openHigh]);
  });

  it("con los tres juntos el orden completo es exacto alto, exacto bajo, sin hints", async () => {
    await conn.db
      .insert(s.skillLevels)
      .values({ userId: USER_A, skillId, level: 3, confidence: 1, state: "respaldada" });
    const exactHigh = await pool({ roleHints: ["qa"] }, true);
    const exactLow = await pool({ roleHints: ["qa"] });
    const openHigh = await pool({ roleHints: [] }, true);
    const r = await run(USER_A, 10, 10);
    expect(await publicIdsOf(r.enqueuedJobIds)).toEqual([exactHigh, exactLow, openHigh]);
  });

  it("el rol exacto entra aunque haya más de 300 avisos sin hints más nuevos", async () => {
    const base = Date.now();
    const filler = Array.from({ length: 305 }, (_, i) => ({
      sourceKind: "remoteok" as const,
      externalId: `${PREFIX}fill-${i}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}fill-${i}`,
      canonicalUrl: `https://example.com/jobs/${PREFIX}fill-${i}`,
      title: "QA Engineer",
      titleNormalized: "qa engineer",
      companyRaw: `Empresa Ficticia F${i}`,
      companyNormalized: `empresa ficticia f${i}`,
      modality: "remoto" as const,
      jdText: `Descripcion ficticia de relleno ${i}.`,
      jdHash: `${PREFIX}fill-hash-${i}`,
      roleHints: [] as string[],
      postedAt: new Date(base - 60_000 - i * 1000),
      firstSeenAt: new Date(base - 3_600_000),
      lastSeenAt: new Date(base),
    }));
    await conn.db.insert(s.publicJobs).values(filler);
    const exact = await pool({ roleHints: ["qa"], postedAt: minutesAgo(10 * 24 * 60) });

    const r = await run(USER_A, 1, 1);
    expect(r.assigned).toBe(1);
    expect((await jobsOf(USER_A))[0]!.publicJobId).toBe(exact);
  });

  it("deductLast24h: dos llamadas seguidas, la segunda asigna 0 y encola 0", async () => {
    for (let i = 0; i < 6; i++) await pool();
    const call = () =>
      assignPoolToUser(conn.db, USER_A, {
        limit: 3,
        enqueueTop: 2,
        deductLast24h: true,
        logger,
      });
    const first = await call();
    expect(first).toMatchObject({ assigned: 3, enqueued: 2 });
    const second = await call();
    expect(second).toMatchObject({ assigned: 0, enqueued: 0 });
    expect(await jobsOf(USER_A)).toHaveLength(3);
  });

  it("deductLast24h en paralelo no pasa del tope", async () => {
    for (let i = 0; i < 8; i++) await pool();
    const call = () =>
      assignPoolToUser(conn.db, USER_A, {
        limit: 3,
        enqueueTop: 2,
        deductLast24h: true,
        logger,
      });
    const [x, y] = await Promise.all([call(), call()]);
    expect(x.assigned + y.assigned).toBe(3);
    expect(x.enqueued + y.enqueued).toBe(2);
  });

  it("limit 0 no asigna nada", async () => {
    await pool();
    expect(await run(USER_A, 0, 3)).toEqual({
      assigned: 0,
      discarded: 0,
      alreadyHad: 0,
      enqueued: 0,
      enqueuedJobIds: [],
      replaced: 0,
    });
    expect(await jobsOf(USER_A)).toHaveLength(0);
  });

  it("sin criterios activos no asigna y no falla", async () => {
    await pool({ roleHints: [] });
    const r = await run(USER_NO_RULES, 10, 3);
    expect(r).toEqual({
      assigned: 0,
      discarded: 0,
      alreadyHad: 0,
      enqueued: 0,
      enqueuedJobIds: [],
      replaced: 0,
    });
    expect(await jobsOf(USER_NO_RULES)).toHaveLength(0);
  });

  it("no asigna avisos viejos: sin verse hace más de 14 días o publicados hace más de 30", async () => {
    await pool({ lastSeenAt: minutesAgo(15 * 24 * 60) });
    await pool({ postedAt: minutesAgo(31 * 24 * 60) });
    const fresh = await pool({ postedAt: null });
    const r = await run(USER_A, 10, 0);
    expect(r.assigned).toBe(1);
    expect((await jobsOf(USER_A))[0]!.publicJobId).toBe(fresh);
  });

  it("las copias del pool (dedup_of_id) no se asignan, la raíz sí", async () => {
    const root = await pool();
    await pool({ dedupOfId: root });
    const r = await run(USER_A, 10, 0);
    expect(r.assigned).toBe(1);
    expect((await jobsOf(USER_A))[0]!.publicJobId).toBe(root);
  });
});

describe("assignPoolToUser · prefiltro", () => {
  it("remote_only: la híbrida se descarta y no crea fila", async () => {
    const remote = await pool({ modality: "remoto" });
    await pool({ modality: "hibrido" });
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 1 });
    const rows = await jobsOf(USER_A);
    expect(rows.map((j) => j.publicJobId)).toEqual([remote]);
  });

  it("sin remote_only la híbrida pasa con el flag de modalidad", async () => {
    await setProfile(USER_A, { remoteOnly: false });
    await pool({ modality: "hibrido" });
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A))[0]!.flags).toContain("modalidad_no_remota");
  });
});

describe("assignPoolToUser · carreras digitales (ADR-015)", () => {
  it("sin puesto no recibe avisos solo digitales, pero sí los sin señal y los de IT", async () => {
    await pool({
      title: "Growth Analyst",
      titleNormalized: "growth analyst",
      roleHints: ["marketing_digital"],
    });
    const open = await pool({ roleHints: [] });
    const it = await pool({
      title: "Backend Developer",
      titleNormalized: "backend developer",
      roleHints: ["backend"],
    });
    const r = await run(USER_B, 10, 0);
    expect(r.assigned).toBe(2);
    expect((await jobsOf(USER_B)).map((j) => j.publicJobId).sort()).toEqual([open, it].sort());
  });

  it("con marketing_digital recibe 'SEO Specialist', que sin puesto se descartaría", async () => {
    const seo = await pool({
      title: "SEO Specialist",
      titleNormalized: "seo specialist",
      roleHints: ["marketing_digital"],
    });
    await setProfile(USER_A, rolesOf("marketing_digital"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([seo]);

    // Control: la misma oferta, para alguien sin puesto, la frena el prefiltro (no el filtro de hints)
    const seoOpen = await pool({
      title: "SEO Specialist",
      titleNormalized: "seo specialist",
      roleHints: [],
    });
    const rb = await run(USER_B, 10, 0);
    expect(rb).toMatchObject({ assigned: 0, discarded: 1 });
    expect(seoOpen).toBeTruthy();
  });

  it("con project_manager recibe 'Project Manager'", async () => {
    const pm = await pool({
      title: "Project Manager",
      titleNormalized: "project manager",
      roleHints: ["project_manager"],
    });
    await setProfile(USER_A, rolesOf("project_manager"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([pm]);
  });

  it("con product_owner recibe 'Product Owner' aunque 'manager' esté en la blocklist", async () => {
    const po = await pool({
      title: "Product Owner",
      titleNormalized: "product owner",
      roleHints: ["product_owner"],
    });
    await setProfile(USER_A, rolesOf("product_owner"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([po]);
  });

  it("con product_manager un 'Scrum Master' que solo tiene hints de categoría queda detrás", async () => {
    // Una categoría de producto reparte las tres carreras; el título vetado no se intercala con las buenas
    const scrum = await pool({
      title: "Scrum Master",
      titleNormalized: "scrum master",
      roleHints: ["product_manager", "product_owner", "project_manager"],
    });
    const pm = await pool({
      title: "Product Manager",
      titleNormalized: "product manager",
      roleHints: ["product_manager", "product_owner", "project_manager"],
    });
    await setProfile(USER_A, rolesOf("product_manager"));
    const r = await run(USER_A, 1, 0);
    expect(r.assigned).toBe(1);
    const got = (await jobsOf(USER_A)).map((j) => j.publicJobId);
    expect(got).toEqual([pm]);
    expect(got).not.toContain(scrum);
  });
});

describe("assignPoolToUser · carreras de tecnología nuevas (ronda 106)", () => {
  it("con solutions_engineer recibe 'Solutions Architect' aunque 'architect' esté en la blocklist", async () => {
    const sa = await pool({
      title: "Solutions Architect",
      titleNormalized: "solutions architect",
      roleHints: ["solutions_engineer"],
    });
    await setProfile(USER_A, rolesOf("solutions_engineer"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([sa]);
  });

  it("con data_engineer recibe 'Data Engineer' y el 'Data Analyst' de la misma categoría queda detrás", async () => {
    const analyst = await pool({
      title: "Data Analyst",
      titleNormalized: "data analyst",
      roleHints: ["data_analyst", "data_engineer"],
    });
    const eng = await pool({
      title: "Data Engineer",
      titleNormalized: "data engineer",
      roleHints: ["data_analyst", "data_engineer"],
    });
    await setProfile(USER_A, rolesOf("data_engineer"));
    const r = await run(USER_A, 1, 0);
    expect(r.assigned).toBe(1);
    const got = (await jobsOf(USER_A)).map((j) => j.publicJobId);
    expect(got).toEqual([eng]);
    expect(got).not.toContain(analyst);
  });
});

describe("assignPoolToUser · ventas y atención (ronda 107)", () => {
  it("con ventas_b2b recibe 'Sales Manager' y 'Vendedor' aunque la blocklist y NON_IT_TITLE los descarten", async () => {
    const sm = await pool({
      title: "Sales Manager",
      titleNormalized: "sales manager",
      roleHints: ["ventas_b2b"],
    });
    const seller = await pool({
      title: "Vendedor de soluciones B2B",
      titleNormalized: "vendedor de soluciones b2b",
      roleHints: ["ventas_b2b"],
    });
    await setProfile(USER_A, rolesOf("ventas_b2b"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 2, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId).sort()).toEqual([sm, seller].sort());
  });

  it("con atencion_cliente recibe 'Atención al Cliente' y el 'Customer Success Manager' de la misma categoría queda detrás", async () => {
    const csm = await pool({
      title: "Customer Success Manager",
      titleNormalized: "customer success manager",
      roleHints: ["customer_success", "atencion_cliente"],
    });
    const support = await pool({
      title: "Atención al Cliente",
      titleNormalized: "atencion al cliente",
      roleHints: ["customer_success", "atencion_cliente"],
    });
    await setProfile(USER_A, rolesOf("atencion_cliente"));
    const r = await run(USER_A, 1, 0);
    expect(r.assigned).toBe(1);
    const got = (await jobsOf(USER_A)).map((j) => j.publicJobId);
    expect(got).toEqual([support]);
    expect(got).not.toContain(csm);
  });
});

describe("assignPoolToUser · finanzas y operaciones (C-2b)", () => {
  it("con finanzas_contabilidad recibe 'Auxiliar contable'", async () => {
    const acc = await pool({
      title: "Auxiliar contable",
      titleNormalized: "auxiliar contable",
      roleHints: ["finanzas_contabilidad"],
    });
    await setProfile(USER_A, rolesOf("finanzas_contabilidad"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([acc]);
  });

  it("con asistencia_operaciones recibe 'Asistente administrativa'", async () => {
    const asst = await pool({
      title: "Asistente administrativa",
      titleNormalized: "asistente administrativa",
      roleHints: ["asistencia_operaciones"],
    });
    await setProfile(USER_A, rolesOf("asistencia_operaciones"));
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, discarded: 0 });
    expect((await jobsOf(USER_A)).map((j) => j.publicJobId)).toEqual([asst]);
  });

  it("sin ese puesto, los dos avisos se descartan", async () => {
    await pool({
      title: "Auxiliar contable",
      titleNormalized: "auxiliar contable",
      roleHints: ["finanzas_contabilidad"],
    });
    await pool({
      title: "Asistente administrativa",
      titleNormalized: "asistente administrativa",
      roleHints: ["asistencia_operaciones"],
    });
    await setProfile(USER_A, rolesOf("data_engineer"));
    const r = await run(USER_A, 10, 0);
    expect(r.assigned).toBe(0);
    expect(await jobsOf(USER_A)).toEqual([]);
  });
});

describe("assignPoolToUser · sin duplicar", () => {
  it("no duplica lo que ya tiene por URL canónica ni por jd_hash, ni en una segunda corrida", async () => {
    const urlDup = await pool();
    const hashDup = await pool({ jdHash: `${PREFIX}shared-hash` });
    const fresh = await pool();
    const urlRow = (
      await conn.db.select().from(s.publicJobs).where(eq(s.publicJobs.id, urlDup))
    )[0]!;
    await conn.db.insert(s.jobs).values([
      {
        userId: USER_A,
        companyRaw: "Empresa Ficticia X",
        title: "QA Engineer",
        titleNormalized: "qa engineer",
        canonicalUrl: urlRow.canonicalUrl,
      },
      {
        userId: USER_A,
        companyRaw: "Empresa Ficticia Y",
        title: "QA Engineer",
        titleNormalized: "qa engineer",
        canonicalUrl: "https://example.com/otra-url",
        jdHash: `${PREFIX}shared-hash`,
      },
    ]);
    expect(hashDup).toBeTruthy();

    const first = await run(USER_A, 10, 0);
    expect(first).toMatchObject({ assigned: 1, alreadyHad: 0 });
    const ids = (await jobsOf(USER_A)).map((j) => j.publicJobId).filter(Boolean);
    expect(ids).toEqual([fresh]);

    const second = await run(USER_A, 10, 0);
    expect(second).toMatchObject({ assigned: 0, discarded: 0, alreadyHad: 0 });
    expect(await jobsOf(USER_A)).toHaveLength(3);
  });

  it("dos avisos del pool con la misma URL: el segundo choca con el índice único y cuenta como ya tenido", async () => {
    const url = `https://example.com/jobs/${PREFIX}misma`;
    await pool({ canonicalUrl: url });
    await pool({ canonicalUrl: url });
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 1, alreadyHad: 1 });
    expect(await jobsOf(USER_A)).toHaveLength(1);
  });

  it("dos corridas simultáneas no duplican (lock por usuario)", async () => {
    for (let i = 0; i < 4; i++) await pool();
    const [x, y] = await Promise.all([run(USER_A, 10, 2), run(USER_A, 10, 2)]);
    expect(x.assigned + y.assigned).toBe(4);
    expect(await jobsOf(USER_A)).toHaveLength(4);
    expect(x.enqueued + y.enqueued).toBe(2);
  });
});

describe("assignPoolToUser · aislamiento", () => {
  it("A no recibe nada de B ni B ve lo de A", async () => {
    await pool();
    await pool();
    const a = await run(USER_A, 10, 5);
    expect(a.assigned).toBe(2);
    expect(await jobsOf(USER_B)).toHaveLength(0);

    const b = await run(USER_B, 10, 5);
    expect(b.assigned).toBe(2);

    const aJobs = await jobsOf(USER_A);
    const bJobs = await jobsOf(USER_B);
    const aIds = new Set(aJobs.map((j) => j.id));
    expect(bJobs.some((j) => aIds.has(j.id))).toBe(false);
    expect(aJobs.every((j) => j.userId === USER_A)).toBe(true);
    expect(bJobs.every((j) => j.userId === USER_B)).toBe(true);

    const queued = await conn.db.select().from(s.jobQueue);
    for (const m of queued.filter((q) => USERS.includes(q.userId ?? ""))) {
      const owner = [...aJobs, ...bJobs].find(
        (j) => j.id === (m.payload as { jobId: string }).jobId,
      );
      expect(owner?.userId).toBe(m.userId);
    }
  });
});

describe("assignPoolToUser · cola y copia de campos", () => {
  it("encola solo enqueueTop y solo con JD; sin JD queda pendiente_jd", async () => {
    await conn.db
      .insert(s.skillLevels)
      .values({ userId: USER_A, skillId, level: 3, confidence: 1, state: "respaldada" });
    const noJd = await pool({ jdText: null, jdHash: null }, true); // mejor score pero sin JD
    const j1 = await pool({ postedAt: minutesAgo(1) });
    const j2 = await pool({ postedAt: minutesAgo(2) });
    await pool({ postedAt: minutesAgo(3) });

    const r = await run(USER_A, 10, 2);
    expect(r).toMatchObject({ assigned: 4, enqueued: 2 });
    expect(await publicIdsOf(r.enqueuedJobIds)).toEqual([j1, j2]);

    const queue = await conn.db.select().from(s.jobQueue).where(eq(s.jobQueue.userId, USER_A));
    expect(queue.map((m) => (m.payload as { jobId: string }).jobId).sort()).toEqual(
      [...r.enqueuedJobIds].sort(),
    );
    const rows = await jobsOf(USER_A);
    const noJdRow = rows.find((j) => j.publicJobId === noJd)!;
    expect(noJdRow.status).toBe("pendiente_jd");
    expect(rows.filter((j) => j.status === "prefiltrada")).toHaveLength(3);
  });

  it("job_sources sale del pool: kind, nombre, id externo, url de la fuente y crudo", async () => {
    const pj = await pool(
      {
        sourceKind: "jobicy",
        sourceName: "Jobicy",
        rawRef: "pg:00000000-0000-4000-8000-000000000099",
        countriesAllowed: ["AR"],
      },
      true,
    );
    const [src] = await conn.db.select().from(s.publicJobs).where(eq(s.publicJobs.id, pj));
    await run(USER_A, 10, 0);

    const [job] = await jobsOf(USER_A);
    expect(job).toMatchObject({
      publicJobId: pj,
      companyRaw: src!.companyRaw,
      title: src!.title,
      titleNormalized: src!.titleNormalized,
      canonicalUrl: src!.canonicalUrl,
      jdHash: src!.jdHash,
      jdText: src!.jdText,
      countriesAllowed: ["AR"],
    });
    expect(job!.companyId).not.toBeNull();
    expect(Math.abs(job!.firstSeenAt.getTime() - Date.now())).toBeLessThan(60_000);

    const sources = await conn.db
      .select()
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, job!.id));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "jobicy",
      sourceName: "Jobicy",
      externalId: src!.externalId,
      url: src!.sourceUrl,
      rawRef: "pg:00000000-0000-4000-8000-000000000099",
    });

    const skills = await conn.db
      .select()
      .from(s.jobSkills)
      .where(eq(s.jobSkills.jobId, job!.id))
      .orderBy(asc(s.jobSkills.skillId));
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ skillId, isMust: true });
  });

  it("un título de la blocklist de los criterios se descarta y no crea fila", async () => {
    await pool({ title: "QA Lead", titleNormalized: "qa lead" });
    const r = await run(USER_A, 10, 0);
    expect(r).toMatchObject({ assigned: 0, discarded: 1 });
    expect(await jobsOf(USER_A)).toHaveLength(0);
  });
});

describe("assignPoolToUser · salario", () => {
  it("el salario anual se compara mensualizado con el piso (y un período desconocido no se supone mensual)", async () => {
    // Piso del ejemplo: 3000 mensual. 24000 anual = 2000 mensual: por debajo del piso (-1).
    const low = await pool({ salaryMaxUsd: 24000, salaryPeriod: "anual", postedAt: minutesAgo(1) });
    const unknown = await pool({
      salaryMaxUsd: 24000,
      salaryPeriod: null,
      postedAt: minutesAgo(2),
    });
    const high = await pool({
      salaryMaxUsd: 60000,
      salaryPeriod: "anual",
      postedAt: minutesAgo(3),
    });

    const r = await run(USER_A, 10, 10);
    // Mismo score 5 para unknown y high (más reciente primero); low pierde 1 punto y queda último,
    // aunque sea el más reciente. Si el anual se leyera como mensual, low iría primero.
    expect(await publicIdsOf(r.enqueuedJobIds)).toEqual([unknown, high, low]);
  });
});

describe("áreas de especialidad: baja de orden y marca, sin esconder (C5-3)", () => {
  const FIN = { roleHints: ["finanzas_contabilidad"] };

  async function seedAreas() {
    // El aviso de «sueldos» es el más nuevo, pero la persona eligió solo «impuestos»
    await pool({
      ...FIN,
      title: "Payroll Specialist",
      titleNormalized: "payroll specialist",
      postedAt: minutesAgo(1),
    });
    await pool({
      ...FIN,
      title: "Tax Analyst",
      titleNormalized: "tax analyst",
      postedAt: minutesAgo(5),
    });
    await pool({ ...FIN, title: "Analista", titleNormalized: "analista", postedAt: minutesAgo(3) });
  }
  const titles = async () =>
    (await jobsOf(USER_AREAS))
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((j) => [j.title, j.flags ?? []]);

  it("apagado (el default) no cambia nada: elige por fecha, sin marcas", async () => {
    await seedAreas();
    await assignPoolToUser(conn.db, USER_AREAS, {
      limit: 1,
      enqueueTop: 0,
      logger,
      areasFilter: false,
    });
    const jobs = await jobsOf(USER_AREAS);
    expect(jobs.map((j) => j.title)).toEqual(["Payroll Specialist"]);
    expect(jobs[0]!.flags ?? []).not.toContain("fuera_de_areas");
  });

  it("prendido, con lugar para una sola, elige la del área elegida", async () => {
    await seedAreas();
    await assignPoolToUser(conn.db, USER_AREAS, {
      limit: 1,
      enqueueTop: 0,
      logger,
      areasFilter: true,
    });
    expect((await jobsOf(USER_AREAS)).map((j) => j.title)).toEqual(["Tax Analyst"]);
  });

  it("prendido, con lugar para todas, asigna las tres: la de otra área queda marcada, no escondida", async () => {
    await seedAreas();
    const res = await assignPoolToUser(conn.db, USER_AREAS, {
      limit: 5,
      enqueueTop: 0,
      logger,
      areasFilter: true,
    });
    expect(res.assigned).toBe(3);
    const by = Object.fromEntries(await titles());
    expect(by["Tax Analyst"]).not.toContain("fuera_de_areas");
    expect(by["Payroll Specialist"]).toContain("fuera_de_areas");
    // Un título que ningún área nombra no se marca
    expect(by["Analista"] ?? []).not.toContain("fuera_de_areas");
  });

  it("sin áreas guardadas no marca nada aunque esté prendido", async () => {
    await setProfile(USER_AREAS, { targetSpecialties: null });
    try {
      await seedAreas();
      await assignPoolToUser(conn.db, USER_AREAS, {
        limit: 5,
        enqueueTop: 0,
        logger,
        areasFilter: true,
      });
      for (const j of await jobsOf(USER_AREAS))
        expect(j.flags ?? []).not.toContain("fuera_de_areas");
    } finally {
      await setProfile(USER_AREAS, { targetSpecialties: { finanzas_contabilidad: ["impuestos"] } });
    }
  });
});
