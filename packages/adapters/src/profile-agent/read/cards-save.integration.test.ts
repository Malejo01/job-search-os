import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, isRemoteDatabase, schema as s } from "@job-search-os/db";
import {
  HISTORY_MAX_ENTRIES,
  MAX_CUSTOM_SKILLS,
  reviewCardDecisions,
  type AcceptedCard,
  type ProfileCardDecision,
} from "@job-search-os/pipeline";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveAcceptedCards } from "./cards-save";

/**
 * Guardado de tarjetas contra Postgres real y como la app: rol `jobsearch_app` (sin BYPASSRLS) con
 * `app.user_id` fijado. Datos inventados. Lo que prueba: `source = 'cv'`, validación, topes bajo lock,
 * slug contra la base (O6), RLS (nadie escribe ni toca filas de otra persona) y que nada sensible pasa.
 */
const A = "00000000-0000-4000-8000-00000000b201";
const B = "00000000-0000-4000-8000-00000000b202";
const APP_PASSWORD = "jobsearch_app_test";
const SLUGS = ["cards-sql", "cards-python"] as const;

let container: StartedPostgreSqlContainer | null = null;
let owner: ReturnType<typeof createDb>;
let app: ReturnType<typeof createDb>;

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
  if (isRemoteDatabase(ownerUrl))
    throw new Error("cards-save.integration: DATABASE_URL no es local");
  await applyMigrations(ownerUrl, { log: () => {} });
  owner = createDb(ownerUrl, { max: 2 });
  await owner.db.execute(sql.raw(`ALTER ROLE jobsearch_app WITH PASSWORD '${APP_PASSWORD}'`));
  const u = new URL(ownerUrl);
  u.username = "jobsearch_app";
  u.password = APP_PASSWORD;
  app = createDb(u.toString(), { max: 3 });

  const [cat] = (await owner.db.execute(
    sql`select (enum_range(null::skill_category))[1]::text as c`,
  )) as unknown as { c: string }[];
  for (const slug of SLUGS) {
    await owner.db.execute(
      sql`insert into skills (slug, name, category) values (${slug}, ${slug}, ${cat!.c}::skill_category) on conflict (slug) do nothing`,
    );
  }
}, 180_000);

async function clean() {
  for (const id of [A, B]) {
    await owner.db.delete(s.careerHistory).where(eq(s.careerHistory.userId, id));
    await owner.db.delete(s.skillLevels).where(eq(s.skillLevels.userId, id));
    await owner.db.delete(s.userSkills).where(eq(s.userSkills.userId, id));
    await owner.db.delete(s.profiles).where(eq(s.profiles.userId, id));
    await owner.db.delete(s.users).where(eq(s.users.id, id));
  }
}

beforeEach(async () => {
  await clean();
  for (const [id, tag] of [
    [A, "a"],
    [B, "b"],
  ] as const) {
    await owner.db.insert(s.users).values({ id, email: `${tag}@cards.test`, passwordHash: "x" });
    await owner.db.insert(s.profiles).values({
      userId: id,
      displayName: `Persona ${tag}`,
      locationCountry: "AR",
      inboundAddress: `u_cards_${tag}@ingest.example.test`,
    });
  }
});

afterAll(async () => {
  await clean();
  await owner?.db.delete(s.skills).where(inArray(s.skills.slug, [...SLUGS]));
  await app?.close();
  await owner?.close();
  await container?.stop();
});

/** Como la app: transacción con `app.user_id` fijado. */
const asUser = <T>(userId: string, cards: readonly AcceptedCard[]) =>
  app.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return saveAcceptedCards(tx, userId, cards) as Promise<T>;
  });

const hist = (id: string, over: Record<string, unknown> = {}): AcceptedCard => ({
  id,
  kind: "history",
  input: {
    kind: "trabajo",
    organization: "Empresa A",
    title: "Analista",
    startMonth: "2020-03",
    endMonth: null,
    bullets: [],
    ...over,
  } as never,
});

describe("saveAcceptedCards", () => {
  it("experiencia y estudio entran a career_history con source 'cv', sin viñetas", async () => {
    const r = await asUser(A, [
      hist("exp:0"),
      hist("edu:0", {
        kind: "educacion",
        organization: "Instituto B",
        title: "Tecnicatura",
        startMonth: null,
      }),
    ]);
    expect(r).toEqual([
      { id: "exp:0", status: "saved" },
      { id: "edu:0", status: "saved" },
    ]);
    const rows = await owner.db.select().from(s.careerHistory).where(eq(s.careerHistory.userId, A));
    expect(rows.map((x) => [x.kind, x.source, x.bullets])).toEqual([
      ["trabajo", "cv", []],
      ["educacion", "cv", []],
    ]);
    expect(rows.map((x) => x.sort)).toEqual([0, 1]);
  });

  it("un duplicado (mismo tipo, empresa, cargo e inicio) no se vuelve a guardar ni pisa lo manual", async () => {
    await owner.db.insert(s.careerHistory).values({
      userId: A,
      kind: "trabajo",
      organization: "empresa a",
      title: "ANALISTA",
      startMonth: "2020-03",
      bullets: ["Viñeta de la persona"],
      source: "manual",
      sort: 0,
    });
    const r = await asUser(A, [hist("exp:0")]);
    expect(r).toEqual([{ id: "exp:0", status: "duplicate" }]);
    const rows = await owner.db.select().from(s.careerHistory).where(eq(s.careerHistory.userId, A));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", bullets: ["Viñeta de la persona"] });
  });

  it(`tope de ${HISTORY_MAX_ENTRIES} entradas: dos guardados a la vez no lo pasan`, async () => {
    await owner.db.insert(s.careerHistory).values(
      Array.from({ length: HISTORY_MAX_ENTRIES - 1 }, (_, i) => ({
        userId: A,
        kind: "trabajo",
        organization: `Previa ${i}`,
        title: "x",
        sort: i,
      })),
    );
    const [r1, r2] = await Promise.all([
      asUser<{ status: string }[]>(A, [hist("exp:0", { organization: "Empresa X" })]),
      asUser<{ status: string }[]>(A, [hist("exp:1", { organization: "Empresa Y" })]),
    ]);
    expect([r1[0]!.status, r2[0]!.status].sort()).toEqual(["limit", "saved"]);
    const rows = await owner.db.select().from(s.careerHistory).where(eq(s.careerHistory.userId, A));
    expect(rows).toHaveLength(HISTORY_MAX_ENTRIES);
  });

  it("skills de la taxonomía: alta, cambio de nivel y mismo nivel; un slug desconocido no se guarda (O6)", async () => {
    const sk = (id: string, slug: string, level: 1 | 2 | 3): AcceptedCard => ({
      id,
      kind: "skill",
      slug,
      level,
    });
    const first = await asUser(A, [sk("skill:0", "cards-sql", 2), sk("skill:1", "no-existe", 3)]);
    expect(first).toEqual([
      { id: "skill:0", status: "saved" },
      { id: "skill:1", status: "slug_unknown" },
    ]);
    expect(
      await asUser(A, [sk("skill:0", "cards-sql", 3), sk("skill:1", "cards-python", 1)]),
    ).toEqual([
      { id: "skill:0", status: "updated" },
      { id: "skill:1", status: "saved" },
    ]);
    expect(await asUser(A, [sk("skill:0", "cards-sql", 3)])).toEqual([
      { id: "skill:0", status: "unchanged" },
    ]);
    const rows = await owner.db.select().from(s.skillLevels).where(eq(s.skillLevels.userId, A));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.state === "sin_evidencia" && r.confidence === 0.5)).toBe(true);
    // el slug desconocido no apareció como skill propia
    expect(await owner.db.select().from(s.userSkills).where(eq(s.userSkills.userId, A))).toEqual(
      [],
    );
  });

  it(`skills propias: alta, duplicado sin distinguir mayúsculas y tope de ${MAX_CUSTOM_SKILLS}`, async () => {
    const own = (id: string, name: string): AcceptedCard => ({
      id,
      kind: "custom_skill",
      name,
      level: 2,
    });
    expect(await asUser(A, [own("skill:0", "Metabase")])).toEqual([
      { id: "skill:0", status: "saved" },
    ]);
    expect(await asUser(A, [own("skill:0", "metabase")])).toEqual([
      { id: "skill:0", status: "duplicate" },
    ]);
    await owner.db.insert(s.userSkills).values(
      Array.from({ length: MAX_CUSTOM_SKILLS - 2 }, (_, i) => ({
        userId: A,
        name: `Herramienta ${i}`,
        level: 1,
      })),
    );
    const r = await asUser<{ status: string }[]>(A, [
      own("skill:1", "Otra uno"),
      own("skill:2", "Otra dos"),
    ]);
    expect(r.map((x) => x.status).sort()).toEqual(["limit", "saved"]);
    const rows = await owner.db.select().from(s.userSkills).where(eq(s.userSkills.userId, A));
    expect(rows).toHaveLength(MAX_CUSTOM_SKILLS);
  });

  it("inglés con CEFR va a profiles.english_cefr; otros idiomas no se guardan", async () => {
    const r = await asUser(A, [
      { id: "lang:0", kind: "english", cefr: "C1" },
      { id: "lang:1", kind: "language_preview", name: "Portugués", level: "B2" },
    ]);
    expect(r).toEqual([
      { id: "lang:0", status: "updated" },
      { id: "lang:1", status: "preview_only" },
    ]);
    const [p] = await owner.db.select().from(s.profiles).where(eq(s.profiles.userId, A));
    expect(p!.englishCefr).toBe("C1");
    expect(await asUser(A, [{ id: "lang:0", kind: "english", cefr: "C1" }])).toEqual([
      { id: "lang:0", status: "unchanged" },
    ]);
    // el resumen del perfil no se toca
    expect(p!.profileSummary).toBeNull();
  });

  it("RLS: lo guardado como A no se ve ni se toca como B", async () => {
    await asUser(A, [hist("exp:0"), { id: "skill:0", kind: "skill", slug: "cards-sql", level: 2 }]);
    const seenByB = await app.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${B}, true)`);
      return {
        history: await tx.select().from(s.careerHistory),
        levels: await tx.select().from(s.skillLevels),
      };
    });
    expect(seenByB.history).toEqual([]);
    expect(seenByB.levels).toEqual([]);
  });

  it("RLS: sin contexto de persona no se puede guardar nada", async () => {
    await expect(
      app.db.transaction(async (tx) => saveAcceptedCards(tx, A, [hist("exp:0")])),
    ).rejects.toThrow();
    expect(
      await owner.db.select().from(s.careerHistory).where(eq(s.careerHistory.userId, A)),
    ).toEqual([]);
  });

  it("RLS: con el contexto de B no se escribe como A", async () => {
    await expect(
      app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${B}, true)`);
        return saveAcceptedCards(tx, A, [hist("exp:0")]);
      }),
    ).rejects.toThrow();
    expect(
      await owner.db
        .select()
        .from(s.careerHistory)
        .where(like(s.careerHistory.organization, "Empresa%")),
    ).toEqual([]);
  });

  it("de punta a punta con la revisión: lo sensible y el slug inventado no llegan a la base", async () => {
    const decisions: ProfileCardDecision[] = [
      {
        id: "exp:0",
        decision: "accept",
        card: {
          kind: "experience",
          id: "exp:0",
          organization: "Empresa A",
          title: "Estado civil: soltera",
          startMonth: null,
          endMonth: null,
          isCurrent: false,
          bullets: [],
        },
      },
      {
        id: "skill:0",
        decision: "accept",
        card: {
          kind: "skill",
          id: "skill:0",
          name: "COBOL",
          slug: "cobol",
          level: 3,
          verified: false,
        },
      },
      {
        id: "skill:1",
        decision: "accept",
        card: {
          kind: "skill",
          id: "skill:1",
          name: "SQL",
          slug: "cards-sql",
          level: 2,
          verified: true,
        },
      },
    ];
    const review = reviewCardDecisions(
      decisions,
      SLUGS.map((slug) => ({ slug, name: slug, aliases: [] })),
    );
    expect(review.rejected.map((x) => x.reason)).toEqual(["sensitive", "slug_unknown"]);
    await asUser(A, review.accepted);
    expect(
      await owner.db.select().from(s.careerHistory).where(eq(s.careerHistory.userId, A)),
    ).toEqual([]);
    expect(await owner.db.select().from(s.userSkills).where(eq(s.userSkills.userId, A))).toEqual(
      [],
    );
    expect(
      await owner.db.select().from(s.skillLevels).where(eq(s.skillLevels.userId, A)),
    ).toHaveLength(1);
  });
});
