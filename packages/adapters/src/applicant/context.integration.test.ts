import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { createDb, schema as s } from "@job-search-os/db";
import criteria from "@job-search-os/db/seeds/criteria.example.json";
import example from "@job-search-os/db/seeds/applicant.example.json";
import { parseApplicantFile, type ApplicantFile } from "@job-search-os/pipeline";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ApplicantFailure,
  getCandidateProfile,
  listAnswers,
  NO_FACTS,
  NO_FIXED_ANSWERS,
  NOT_LOADED,
  saveAnswer,
  saveApplicationAnswers,
} from "./context";
import { syncApplicant } from "./sync";

/**
 * JS-053 · Lo que hay detrás de las tools MCP get_candidate_profile, list_answers, save_answer y
 * save_application_answers. El aislamiento entre usuarios está en rls.integration.test.ts; acá,
 * que cada función haga lo que la tool promete.
 */
const USER = "a0000000-0000-4000-8000-000000000053";
const OTHER = "b0000000-0000-4000-8000-000000000053";
let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

async function newJob(userId: string, p: Partial<typeof s.jobs.$inferInsert> = {}) {
  const [row] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      companyRaw: "Empresa Z",
      title: "Backend Engineer",
      titleNormalized: "backend engineer",
      ...p,
    })
    .returning({ id: s.jobs.id });
  return row!.id;
}

async function setCriteriaFloor(floor: number) {
  await conn.db
    .update(s.evaluationCriteria)
    .set({ rules: { ...criteria, salary_floor_usd_monthly: floor } as never })
    .where(eq(s.evaluationCriteria.userId, USER));
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
  await conn.db
    .insert(s.profiles)
    .values({
      userId: USER,
      displayName: "Test",
      headline: "AI Engineer",
      locationCountry: "AR",
      locationCity: "Ciudad Ejemplo",
      inboundAddress: "u_a053@ingest.test",
      englishCefr: "C1",
      salaryFloorUsd: 1500,
      profileSummary: "Resumen de ejemplo.",
    })
    .onConflictDoNothing();
  await conn.db
    .insert(s.evaluationCriteria)
    .values({ userId: USER, version: 1, active: true, rules: criteria as never })
    .onConflictDoNothing();
  await setCriteriaFloor(1500);
}, 180_000);

afterAll(async () => {
  await conn?.close();
  await container?.stop();
});

describe("getCandidateProfile", () => {
  it("perfil, hechos activos en orden, respuestas fijas y sueldo sin oferta = piso", async () => {
    await conn.db.insert(s.candidateFacts).values([
      { userId: USER, key: "b", project: "P2", claim: "Segundo", source: "S", sort: 2 },
      {
        userId: USER,
        key: "a",
        project: "P1",
        claim: "Primero",
        metric: "80+",
        source: "S",
        verification: "autodeclarado",
        sort: 1,
      },
      { userId: USER, key: "x", project: "P", claim: "Inactivo", source: "S", active: false },
    ]);
    await conn.db.insert(s.applicationSettings).values({
      userId: USER,
      availability: "Inmediata",
      links: { github: "https://github.com/ejemplo" },
    });

    const out = await getCandidateProfile(conn.db, { userId: USER });
    expect(out.profile).toMatchObject({
      headline: "AI Engineer",
      location: { city: "Ciudad Ejemplo", country: "AR" },
      english_cefr: "C1",
    });
    if (!Array.isArray(out.facts)) throw new Error("se esperaban hechos cargados");
    expect(out.facts.map((f) => f.claim)).toEqual(["Primero", "Segundo"]);
    expect(out.facts[0]).toMatchObject({ metric: "80+", verification: "autodeclarado" });
    expect(out.fixed_answers).toEqual({
      availability: "Inmediata",
      contract: NOT_LOADED,
      work_authorization: NOT_LOADED,
      links: { github: "https://github.com/ejemplo" },
    });
    expect(out.salary).toEqual({
      kind: "pedir",
      usdMonthly: 1500,
      basis: "piso_sin_rango",
      job_id: null,
    });
  });

  it("con job_id calcula el sueldo de esa oferta", async () => {
    const jobId = await newJob(USER, {
      salaryMinUsd: 3200,
      salaryMaxUsd: 4500,
      salaryPeriod: "mensual",
    });
    const out = await getCandidateProfile(conn.db, { userId: USER, jobId });
    expect(out.salary).toEqual({
      kind: "pedir",
      usdMonthly: 3200,
      basis: "minimo_del_rango",
      job_id: jobId,
    });
  });

  it("piso distinto entre perfil y criterios activos → marca, no número", async () => {
    await setCriteriaFloor(1700);
    try {
      const out = await getCandidateProfile(conn.db, { userId: USER });
      expect(out.salary).toMatchObject({
        kind: "piso_inconsistente",
        profileFloorUsd: 1500,
        criteriaFloorUsd: 1700,
      });
    } finally {
      await setCriteriaFloor(1500);
    }
  });

  it("oferta de otro usuario o sin perfil → error con código", async () => {
    const foreign = await newJob(OTHER);
    await expect(getCandidateProfile(conn.db, { userId: USER, jobId: foreign })).rejects.toThrow(
      ApplicantFailure,
    );
    await expect(getCandidateProfile(conn.db, { userId: OTHER })).rejects.toThrow(
      /profile_not_found/,
    );
  });

  it("sin hechos ni respuestas fijas cargados → marcas explícitas, no listas ni campos vacíos", async () => {
    const EMPTY = "d0000000-0000-4000-8000-000000000053";
    await conn.db.insert(s.profiles).values({
      userId: EMPTY,
      displayName: "Vacío",
      locationCountry: "AR",
      inboundAddress: "u_d053@ingest.test",
    });
    const out = await getCandidateProfile(conn.db, { userId: EMPTY });
    expect(out.facts).toEqual(NO_FACTS);
    expect(out.fixed_answers).toEqual(NO_FIXED_ANSWERS);
    expect(JSON.stringify(out)).toContain("sin_hechos_cargados");
  });

  it("respuestas fijas cargadas a medias → el campo que falta dice que no está cargado", async () => {
    const PARTIAL = "e0000000-0000-4000-8000-000000000053";
    await conn.db.insert(s.profiles).values({
      userId: PARTIAL,
      displayName: "Parcial",
      locationCountry: "AR",
      inboundAddress: "u_e053@ingest.test",
    });
    await conn.db.insert(s.applicationSettings).values({ userId: PARTIAL, contract: "Contractor" });
    const out = await getCandidateProfile(conn.db, { userId: PARTIAL });
    expect(out.fixed_answers).toEqual({
      availability: NOT_LOADED,
      contract: "Contractor",
      work_authorization: NOT_LOADED,
      links: {},
    });
  });
});

describe("saveAnswer + listAnswers", () => {
  it("guarda, reemplaza la misma pregunta normalizada y devuelve oferta de origen y fechas", async () => {
    const jobId = await newJob(USER);
    const first = await saveAnswer(conn.db, {
      userId: USER,
      question: "What are your salary expectations?",
      answer: "A convenir",
      lang: "en",
      jobId,
      now: () => new Date("2026-09-20T10:00:00Z"),
    });
    expect(first.replaced).toBe(false);

    const second = await saveAnswer(conn.db, {
      userId: USER,
      question: "what are your SALARY expectations*",
      answer: "A convenir, por mes",
      lang: "en",
      now: () => new Date("2026-09-21T10:00:00Z"),
    });
    expect(second).toEqual({ id: first.id, replaced: true });

    const [only] = await listAnswers(conn.db, { userId: USER, query: "salary", limit: 10 });
    expect(only).toEqual({
      id: first.id,
      question: "what are your SALARY expectations*",
      answer: "A convenir, por mes",
      lang: "en",
      source_job_id: null,
      created_at: "2026-09-20T10:00:00.000Z",
      updated_at: "2026-09-21T10:00:00.000Z",
    });
  });

  it("otro idioma es otra fila; lang filtra y la consulta ordena", async () => {
    const jobId = await newJob(USER);
    await saveAnswer(conn.db, {
      userId: USER,
      question: "What are your salary expectations?",
      answer: "A convenir, mensual",
      lang: "es",
      jobId,
    });
    await saveAnswer(conn.db, {
      userId: USER,
      question: "When can you start?",
      answer: "Immediately",
      lang: "en",
    });
    const es = await listAnswers(conn.db, { userId: USER, lang: "es", limit: 10 });
    expect(es.map((a) => [a.lang, a.source_job_id])).toEqual([["es", jobId]]);
    const start = await listAnswers(conn.db, { userId: USER, query: "start date", limit: 10 });
    expect(start.map((a) => a.answer)).toEqual(["Immediately"]);
    expect(await listAnswers(conn.db, { userId: OTHER, limit: 10 })).toEqual([]);
  });

  it("pregunta vacía u oferta ajena → error, sin escribir", async () => {
    await expect(
      saveAnswer(conn.db, { userId: USER, question: " ¿? ", answer: "x", lang: "es" }),
    ).rejects.toThrow(/empty_question/);
    const foreign = await newJob(OTHER);
    await expect(
      saveAnswer(conn.db, {
        userId: USER,
        question: "Pregunta nueva",
        answer: "x",
        lang: "es",
        jobId: foreign,
      }),
    ).rejects.toThrow(/job_not_found/);
    const rows = await conn.db
      .select()
      .from(s.answerBank)
      .where(eq(s.answerBank.questionNormalized, "pregunta nueva"));
    expect(rows).toEqual([]);
  });
});

describe("saveApplicationAnswers", () => {
  const answersOf = (jobId: string) =>
    conn.db
      .select({ position: s.applicationAnswers.position, question: s.applicationAnswers.question })
      .from(s.applicationAnswers)
      .where(and(eq(s.applicationAnswers.userId, USER), eq(s.applicationAnswers.jobId, jobId)))
      .orderBy(s.applicationAnswers.position);

  it("guarda en orden y volver a mandar el formulario lo reemplaza entero", async () => {
    const jobId = await newJob(USER);
    expect(
      await saveApplicationAnswers(conn.db, {
        userId: USER,
        jobId,
        qa: [
          { question: "Q1", answer: "R1" },
          { question: "Q2", answer: "R2" },
        ],
      }),
    ).toEqual({ job_id: jobId, saved: 2, replaced: 0 });

    expect(
      await saveApplicationAnswers(conn.db, {
        userId: USER,
        jobId,
        qa: [
          { question: " Q1 ", answer: "R1 corregida" },
          { question: "Q2", answer: "R2" },
          { question: "Q3", answer: "R3" },
        ],
      }),
    ).toEqual({ job_id: jobId, saved: 3, replaced: 2 });
    expect(await answersOf(jobId)).toEqual([
      { position: 0, question: "Q1" },
      { position: 1, question: "Q2" },
      { position: 2, question: "Q3" },
    ]);
  });

  it("formulario vacío, respuesta en blanco u oferta ajena → error y no toca lo guardado", async () => {
    const jobId = await newJob(USER);
    await saveApplicationAnswers(conn.db, {
      userId: USER,
      jobId,
      qa: [{ question: "Q", answer: "R" }],
    });
    await expect(saveApplicationAnswers(conn.db, { userId: USER, jobId, qa: [] })).rejects.toThrow(
      /empty_form/,
    );
    await expect(
      saveApplicationAnswers(conn.db, {
        userId: USER,
        jobId,
        qa: [{ question: "Q", answer: " " }],
      }),
    ).rejects.toThrow(/empty_question/);
    const foreign = await newJob(OTHER);
    await expect(
      saveApplicationAnswers(conn.db, {
        userId: USER,
        jobId: foreign,
        qa: [{ question: "Q", answer: "R" }],
      }),
    ).rejects.toThrow(/job_not_found/);
    expect(await answersOf(jobId)).toHaveLength(1);
  });

  it("borrar la oferta borra su formulario", async () => {
    const jobId = await newJob(USER);
    await saveApplicationAnswers(conn.db, {
      userId: USER,
      jobId,
      qa: [{ question: "Q", answer: "R" }],
    });
    await conn.db.delete(s.jobs).where(eq(s.jobs.id, jobId));
    expect(await answersOf(jobId)).toEqual([]);
  });
});

describe("syncApplicant (pnpm applicant:sync)", () => {
  const SYNC_USER = "c0000000-0000-4000-8000-000000000053";
  const file = (): ApplicantFile => {
    const r = parseApplicantFile(example);
    if (!r.ok) throw new Error(r.error.join("; "));
    return r.value;
  };
  const facts = () =>
    conn.db
      .select({ key: s.candidateFacts.key, active: s.candidateFacts.active })
      .from(s.candidateFacts)
      .where(eq(s.candidateFacts.userId, SYNC_USER))
      .orderBy(asc(s.candidateFacts.key));

  it("el ejemplo del repo es válido", () => {
    expect(file().facts.length).toBeGreaterThan(0);
  });

  it("sin --apply muestra el plan y no escribe nada", async () => {
    const r = await syncApplicant(conn.db, { userId: SYNC_USER, file: file(), apply: false });
    expect(r.applied).toBe(false);
    expect(r.facts.insert).toHaveLength(file().facts.length);
    expect(r.settings).toEqual({
      changed: ["availability", "contract", "workAuthorization", "links"],
      created: true,
    });
    expect(await facts()).toEqual([]);
  });

  it("aplica, y correrlo de nuevo no cambia nada", async () => {
    await syncApplicant(conn.db, { userId: SYNC_USER, file: file(), apply: true });
    expect((await facts()).every((f) => f.active)).toBe(true);
    const again = await syncApplicant(conn.db, { userId: SYNC_USER, file: file(), apply: false });
    expect(again.facts).toMatchObject({ insert: [], update: [], deactivate: [] });
    expect(again.settings.changed).toEqual([]);
  });

  it("un hecho que sale del archivo se desactiva; si vuelve, se reactiva", async () => {
    const full = file();
    const [gone, ...rest] = full.facts;
    await syncApplicant(conn.db, {
      userId: SYNC_USER,
      file: { ...full, facts: rest },
      apply: true,
    });
    expect((await facts()).find((f) => f.key === gone!.key)).toEqual({
      key: gone!.key,
      active: false,
    });
    const back = await syncApplicant(conn.db, { userId: SYNC_USER, file: full, apply: true });
    expect(back.facts.update).toEqual([{ key: gone!.key, fact: gone, fields: ["active"] }]);
    expect((await facts()).every((f) => f.active)).toBe(true);
  });

  it("cambiar una respuesta fija actualiza solo ese campo", async () => {
    const full = file();
    const r = await syncApplicant(conn.db, {
      userId: SYNC_USER,
      file: { ...full, settings: { ...full.settings, availability: "En 2 semanas" } },
      apply: true,
    });
    expect(r.settings).toEqual({ changed: ["availability"], created: false });
    const [row] = await conn.db
      .select()
      .from(s.applicationSettings)
      .where(eq(s.applicationSettings.userId, SYNC_USER));
    expect(row).toMatchObject({ availability: "En 2 semanas", contract: full.settings.contract });
  });
});
