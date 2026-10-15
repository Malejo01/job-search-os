import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import { criteriaFromOnboarding } from "@job-search-os/pipeline";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inReadOnlyTransaction, parsePersona, runExplain, type ExplainArgs } from "./explain";
import { selectPoolCandidates } from "./select";

/**
 * Ronda 51 · Selección del pool en modo persona (sin usuario) y diagnóstico de solo lectura. Sin red
 * ni LLM; avisos inventados (Empresa Ficticia N, example.com).
 */
const USER = "a0000000-0000-4000-8000-0000000000d4";
const PREFIX = "select-test-";
const SKILL_SLUG = "select_test_skill";
const NOW = new Date();

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;
let skillId: string;
let seq = 0;

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
type PoolInsert = typeof s.publicJobs.$inferInsert;

async function pool(over: Partial<PoolInsert> = {}) {
  const n = ++seq;
  const [row] = await conn.db
    .insert(s.publicJobs)
    .values({
      sourceKind: "remoteok",
      externalId: `${PREFIX}${n}`,
      sourceName: "Remote OK",
      sourceUrl: `https://example.com/jobs/${PREFIX}${n}?ref=pool`,
      canonicalUrl: `https://example.com/jobs/${PREFIX}${n}`,
      title: "Data Analyst",
      titleNormalized: "data analyst",
      companyRaw: `Empresa Ficticia ${n}`,
      companyNormalized: `empresa ficticia ${n}`,
      modality: "remoto",
      jdText: `Descripcion ficticia numero ${n} del puesto, solo para pruebas.`,
      jdHash: `${PREFIX}hash-${n}`,
      roleHints: ["data_analyst"],
      postedAt: daysAgo(1 + n / 100),
      firstSeenAt: daysAgo(3),
      lastSeenAt: NOW,
      ...over,
    })
    .returning({ id: s.publicJobs.id });
  return row!.id;
}

const rules = criteriaFromOnboarding({ salaryFloorUsd: null, maxWeeklyHours: null });
const prefs = { country: "AR", remoteOnly: true, targetRoles: ["data_analyst" as const] };

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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      locationCountry: "AR",
      remoteOnly: true,
      inboundAddress: "u_d4@ingest.test",
    })
    .onConflictDoNothing();
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

beforeEach(async () => {
  await conn.db.delete(s.jobs).where(eq(s.jobs.userId, USER));
  await conn.db.delete(s.publicJobs).where(like(s.publicJobs.externalId, `${PREFIX}%`));
});

describe("selectPoolCandidates", () => {
  it("modo persona: no mira lo que la cuenta ya tiene; con userId la deja afuera", async () => {
    const mine = await pool({ title: "Data Analyst Mina" });
    const other = await pool({ title: "Data Analyst Otra" });
    await conn.db.insert(s.jobs).values({
      userId: USER,
      companyRaw: "Empresa Ficticia X",
      title: "Data Analyst Mina",
      titleNormalized: "data analyst mina",
      publicJobId: mine,
      status: "prefiltrada",
    });
    const input = { rules, prefs, levelBySkill: new Map<string, number>(), now: NOW, limit: 30 };

    const persona = await selectPoolCandidates(conn.db, { ...input, userId: null });
    expect(persona.ranked.map((r) => r.row.id).sort()).toEqual([mine, other].sort());

    const user = await selectPoolCandidates(conn.db, { ...input, userId: USER });
    expect(user.ranked.map((r) => r.row.id)).toEqual([other]);
  });

  it("separa elegidas, descartadas y candidatas, y respeta el límite con rank global", async () => {
    const ok1 = await pool({ title: "Data Analyst Uno" });
    const ok2 = await pool({ title: "Data Analyst Dos" });
    const blocked = await pool({ title: "Director de Datos" });
    await pool({ roleHints: ["qa"], title: "QA Engineer" });
    await pool({ postedAt: daysAgo(45), title: "Data Analyst Viejo" });

    const sel = await selectPoolCandidates(conn.db, {
      userId: null,
      rules,
      prefs,
      levelBySkill: new Map(),
      now: NOW,
      limit: 1,
    });
    expect(sel.candidateCount).toBe(3);
    expect(sel.discarded.map((d) => [d.row.id, d.reason])).toEqual([[blocked, "titulo_blocklist"]]);
    expect(sel.ranked).toHaveLength(1);
    expect(sel.ranked[0]!.rank).toBe(1);
    expect(sel.rankedIds).toHaveLength(2);
    expect(new Set(sel.rankedIds)).toEqual(new Set([ok1, ok2]));
  });
});

describe("selectPoolCandidates · ronda 51-b", () => {
  const input = {
    userId: null,
    rules,
    prefs: { ...prefs, yearsTotal: 3 },
    levelBySkill: new Map<string, number>(),
    now: NOW,
    limit: 30,
  };

  it("descarta por ubicación y por nivel, con su razón", async () => {
    const onlyUs = await pool({ title: "Data Analyst US", locationRaw: "Remote - US" });
    const latam = await pool({ title: "Data Analyst LATAM", locationRaw: "Remoto (LATAM)" });
    const staff = await pool({ title: "Staff Data Analyst" });
    const sel = await selectPoolCandidates(conn.db, input);
    const reasons = Object.fromEntries(sel.discarded.map((d) => [d.row.id, d.reason]));
    expect(reasons[onlyUs]).toBe("ubicacion");
    expect(reasons[staff]).toMatch(/^(nivel|titulo_blocklist)$/);
    expect(sel.ranked.map((r) => r.row.id)).toContain(latam);
    expect(reasons[latam]).toBeUndefined();
  });

  it("sin país o con 5 años o más no descarta por ubicación ni por nivel", async () => {
    const onlyUs = await pool({ title: "Data Analyst US", locationRaw: "Remote - US" });
    const noCountry = await selectPoolCandidates(conn.db, {
      ...input,
      prefs: { ...input.prefs, country: null },
    });
    expect(noCountry.ranked.map((r) => r.row.id)).toContain(onlyUs);
    const staff = await pool({ title: "Principal Data Analyst" });
    const senior = await selectPoolCandidates(conn.db, {
      ...input,
      prefs: { ...input.prefs, yearsTotal: 8 },
    });
    expect(senior.discarded.find((d) => d.row.id === staff)?.reason).not.toBe("nivel");
  });

  it("el veto del título manda la oferta a 'sin señal' y Senior baja dentro del mismo ajuste", async () => {
    const good = await pool({ title: "Data Analyst Junior" });
    const senior = await pool({ title: "Senior Data Analyst" });
    const engineer = await pool({ title: "Data Engineer", roleHints: ["data_analyst"] });
    const sel = await selectPoolCandidates(conn.db, input);
    const order = sel.ranked.map((r) => r.row.id);
    expect(order.indexOf(good)).toBeLessThan(order.indexOf(senior));
    expect(order.indexOf(senior)).toBeLessThan(order.indexOf(engineer));
    const eng = sel.ranked.find((r) => r.row.id === engineer)!;
    expect(eng.titleFit).toBe(0);
    expect(eng.exactRole).toBe(false);
    expect(eng.matchedRole).toBeNull();
    expect(sel.ranked.find((r) => r.row.id === senior)!.seniorPenalty).toBe(1);
  });

  it("los ATS entran por last_seen_at aunque posted_at sea viejo; los demás no", async () => {
    const ats = await pool({
      sourceKind: "greenhouse",
      postedAt: daysAgo(90),
      title: "Fraud Data Analyst",
    });
    const other = await pool({
      sourceKind: "remoteok",
      postedAt: daysAgo(90),
      title: "Data Analyst Viejo",
    });
    const sel = await selectPoolCandidates(conn.db, input);
    expect(sel.candidateIds.has(ats)).toBe(true);
    expect(sel.candidateIds.has(other)).toBe(false);
  });

  it("el título que nombra el cargo entra antes del tope aunque sea más viejo", async () => {
    const rows = Array.from({ length: 300 }, (_, i) => {
      const n = ++seq;
      return {
        sourceKind: "remoteok" as const,
        externalId: `${PREFIX}${n}`,
        sourceName: "Remote OK",
        sourceUrl: `https://example.com/jobs/${PREFIX}${n}`,
        canonicalUrl: `https://example.com/jobs/${PREFIX}${n}`,
        title: `Asociado de Reportes ${i}`,
        titleNormalized: `asociado de reportes ${i}`,
        companyRaw: `Empresa Ficticia ${n}`,
        companyNormalized: `empresa ficticia ${n}`,
        modality: "remoto" as const,
        jdText: `Descripcion ficticia numero ${n}.`,
        jdHash: `${PREFIX}hash-${n}`,
        roleHints: ["data_analyst"],
        postedAt: daysAgo(1),
        firstSeenAt: daysAgo(3),
        lastSeenAt: NOW,
      };
    });
    await conn.db.insert(s.publicJobs).values(rows);
    const strong = await pool({ title: "Data Analyst", postedAt: daysAgo(25) });
    const sel = await selectPoolCandidates(conn.db, input);
    expect(sel.candidateCount).toBe(300);
    expect(sel.candidateIds.has(strong)).toBe(true);
  });
});

describe("runExplain", () => {
  const args = (over: Partial<ExplainArgs> = {}): ExplainArgs => ({
    mode: { kind: "persona", path: "x.json" },
    limit: 30,
    db: "dev",
    why: [],
    ...over,
  });
  const persona = (() => {
    const r = parsePersona({
      targetRoles: ["data_analyst"],
      locationCountry: "AR",
      remoteOnly: true,
      yearsTotal: 3,
      skills: [
        { slug: SKILL_SLUG, level: 2 },
        { slug: "no_existe_en_la_taxonomia", level: 1 },
      ],
    });
    if (!r.ok) throw new Error(r.error);
    return r.persona;
  })();

  it("informa y clasifica con --why, avisa de skills desconocidas y no escribe nada", async () => {
    const win = await pool({ title: "Data Analyst Ganador" });
    await conn.db.insert(s.publicJobSkills).values({
      publicJobId: win,
      skillId,
      isMust: true,
      rawMention: "jd",
    });
    await pool({ title: "Fraud Data Analyst", roleHints: ["qa"] });
    await pool({ title: "Data Analyst Copia", dedupOfId: win });

    const jobsBefore = await conn.db.select().from(s.jobs);
    const report = await runExplain(conn.db, args({ why: ["data analyst", "(", "no-hay-nada"] }), {
      persona,
      personaLabel: "p.json",
      now: NOW,
    });

    expect(report.picks.map((p) => p.row.id)).toEqual([win]);
    expect(report.warnings).toEqual([
      "skill desconocida en la taxonomía: no_existe_en_la_taxonomia",
    ]);
    const steps = Object.fromEntries(report.why[0]!.matches.map((m) => [m.title, m.step]));
    expect(steps).toMatchObject({
      "Data Analyst Ganador": "entro",
      "Fraud Data Analyst": "hints",
      "Data Analyst Copia": "copia",
    });
    expect(report.why[1]!.error).toBeDefined();
    expect(report.why[2]!.matches).toEqual([]);
    expect(await conn.db.select().from(s.jobs)).toHaveLength(jobsBefore.length);
  });

  it("--user sin perfil o sin criterios falla con un mensaje claro", async () => {
    const none = "a0000000-0000-4000-8000-0000000000ff";
    await expect(
      runExplain(conn.db, args({ mode: { kind: "user", userId: none } }), {
        persona: null,
        personaLabel: "",
        now: NOW,
      }),
    ).rejects.toThrow("usá --persona");
    await expect(
      runExplain(conn.db, args({ mode: { kind: "user", userId: USER } }), {
        persona: null,
        personaLabel: "",
        now: NOW,
      }),
    ).rejects.toThrow("usá --persona");
  });

  it("la transacción es de solo lectura: una escritura la rechaza Postgres", async () => {
    await expect(
      inReadOnlyTransaction(conn.db, (tx) =>
        tx.insert(s.skills).values({ slug: "select_test_write", name: "x", category: "otra" }),
      ),
    ).rejects.toThrow();
    const rows = await conn.db
      .select()
      .from(s.skills)
      .where(eq(s.skills.slug, "select_test_write"));
    expect(rows).toHaveLength(0);
  });
});
