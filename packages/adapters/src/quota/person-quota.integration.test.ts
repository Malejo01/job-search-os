import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, schema as s } from "@job-search-os/db";
import { applyMigrations } from "@job-search-os/db/src/migrate";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveAnswer, saveApplicationAnswers } from "../applicant/context";
import { mcpFailure } from "../mcp/errors";
import {
  answerBankUsageQuery,
  applicationAnswersUsageQuery,
  personRawBytesQuery,
  PersonQuotaError,
  reservePersonQuota,
  type AnswerQuotaLimits,
} from "./person-quota";

/**
 * Cuotas que no bloquean lo legítimo: los crudos de correo no cuentan en el espacio de la persona, y las
 * respuestas guardadas tienen tope de filas y de bytes. Postgres real, datos inventados.
 */
const A = "a4200000-0000-4000-8000-000000000001";
const B = "b4200000-0000-4000-8000-000000000002";

let container: StartedPostgreSqlContainer | null = null;
let conn: ReturnType<typeof createDb>;

const BIG = 1_000_000_000;
const limits = (over: Partial<AnswerQuotaLimits> = {}): AnswerQuotaLimits => ({
  bankRows: BIG,
  bankBytes: BIG,
  formRows: BIG,
  formBytes: BIG,
  ...over,
});

const blob = (userId: string | null, kind: string, size: number) => ({
  userId,
  kind,
  contentType: "text/plain",
  body: "x".repeat(size),
  bytes: size,
});

async function seedJob(userId: string, tag: string): Promise<string> {
  const [job] = await conn.db
    .insert(s.jobs)
    .values({
      userId,
      title: `Puesto ${tag}`,
      titleNormalized: `puesto ${tag}`,
      companyRaw: "Empresa A",
    })
    .returning({ id: s.jobs.id });
  return job!.id;
}

const saveWith = (userId: string, n: number, answer: string, l: AnswerQuotaLimits) =>
  conn.db.transaction((tx) =>
    saveAnswer(tx, {
      userId,
      question: `Pregunta número ${n}`,
      answer,
      lang: "es",
      limits: l,
    }),
  );

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
  conn = createDb(ownerUrl, { max: 12 });
}, 180_000);

beforeEach(async () => {
  await conn.db.delete(s.answerBank).where(eq(s.answerBank.userId, A));
  await conn.db.delete(s.applicationAnswers).where(eq(s.applicationAnswers.userId, A));
  await conn.db.delete(s.rawBlobs).where(eq(s.rawBlobs.userId, A));
});

afterAll(async () => {
  await conn?.db.delete(s.answerBank).where(eq(s.answerBank.userId, A));
  await conn?.db.delete(s.jobs).where(eq(s.jobs.userId, A));
  await conn?.db.delete(s.rawBlobs).where(eq(s.rawBlobs.userId, A));
  await conn?.close();
  await container?.stop();
});

describe("cuota de espacio: solo lo que carga la persona", () => {
  const reserve = (incomingBytes: number, maxRawBytes: number) =>
    conn.db.transaction((tx) =>
      reservePersonQuota(
        tx,
        A,
        { newManualJobs: 0, incomingBytes },
        { maxManualJobs: BIG, maxRawBytes },
      ),
    );

  it("los crudos de correo por encima de la cuota no bloquean un pegado", async () => {
    await conn.db
      .insert(s.rawBlobs)
      .values([
        blob(A, "inbound_email", 5_000),
        blob(A, "ingest_email_linkedin", 5_000),
        blob(A, "ingest_email_generic", 5_000),
      ]);
    await expect(reserve(100, 1_000)).resolves.toBeUndefined();
  });

  it("lo que carga la persona sigue contando", async () => {
    await conn.db.insert(s.rawBlobs).values([blob(A, "jd_pegada", 900)]);
    await expect(reserve(200, 1_000)).rejects.toMatchObject({
      name: "PersonQuotaError",
      kind: "raw_bytes",
    });
    await expect(reserve(50, 1_000)).resolves.toBeUndefined();
  });

  it("las cargas manuales y de imagen también cuentan", async () => {
    await conn.db
      .insert(s.rawBlobs)
      .values([blob(A, "ingest_manual", 500), blob(A, "imagen", 450)]);
    await expect(reserve(100, 1_000)).rejects.toBeInstanceOf(PersonQuotaError);
  });
});

describe("tope de respuestas guardadas (answer_bank)", () => {
  it("la respuesta N+1 devuelve cuota_respuestas", async () => {
    const l = limits({ bankRows: 3 });
    for (let i = 0; i < 3; i++) await saveWith(A, i, "Respuesta corta", l);
    const err = await saveWith(A, 99, "Respuesta corta", l).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PersonQuotaError);
    expect(err).toMatchObject({ kind: "answers" });
    expect(mcpFailure(err)).toMatchObject({ code: "cuota_respuestas", expected: true });
  });

  it("reemplazar una respuesta existente no cuenta como una fila más", async () => {
    const l = limits({ bankRows: 3 });
    for (let i = 0; i < 3; i++) await saveWith(A, i, "Respuesta corta", l);
    await expect(saveWith(A, 1, "Otra respuesta corta", l)).resolves.toMatchObject({
      replaced: true,
    });
  });

  it("los bytes por encima del tope también devuelven cuota_respuestas", async () => {
    const l = limits({ bankBytes: 1_000 });
    await saveWith(A, 1, "a".repeat(500), l);
    const err = await saveWith(A, 2, "b".repeat(600), l).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PersonQuotaError);
    expect(mcpFailure(err)).toMatchObject({ code: "cuota_respuestas" });
    // lo que entra justo sigue entrando
    await expect(saveWith(A, 3, "c".repeat(300), l)).resolves.toMatchObject({ replaced: false });
  });

  it("reemplazar por una respuesta mucho más larga también respeta el tope de bytes", async () => {
    const l = limits({ bankBytes: 1_000 });
    await saveWith(A, 1, "a".repeat(200), l);
    await expect(saveWith(A, 1, "a".repeat(5_000), l)).rejects.toBeInstanceOf(PersonQuotaError);
  });

  it("diez altas en paralelo con tope 3: entran exactamente 3", async () => {
    const l = limits({ bankRows: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => saveWith(A, i, "Respuesta corta", l)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(
      results.filter((r) => r.status === "rejected" && r.reason instanceof PersonQuotaError),
    ).toHaveLength(7);
  });

  it("el tope de una persona no frena a otra", async () => {
    const l = limits({ bankRows: 1 });
    await saveWith(A, 1, "Respuesta corta", l);
    await expect(saveWith(B, 1, "Respuesta corta", l)).resolves.toMatchObject({ replaced: false });
    await conn.db.delete(s.answerBank).where(eq(s.answerBank.userId, B));
  });
});

describe("tope de formularios respondidos (application_answers)", () => {
  const form = (n: number, size = 10) =>
    Array.from({ length: n }, (_, i) => ({ question: `Pregunta ${i}`, answer: "r".repeat(size) }));
  const saveForm = (jobId: string, qa: ReturnType<typeof form>, l: AnswerQuotaLimits) =>
    conn.db.transaction((tx) => saveApplicationAnswers(tx, { userId: A, jobId, qa, limits: l }));

  it("por encima del tope de filas devuelve cuota_respuestas; reemplazar la misma oferta entra", async () => {
    const j1 = await seedJob(A, "f1");
    const j2 = await seedJob(A, "f2");
    const l = limits({ formRows: 5 });
    await saveForm(j1, form(3), l);
    const err = await saveForm(j2, form(3), l).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PersonQuotaError);
    expect(mcpFailure(err)).toMatchObject({ code: "cuota_respuestas" });
    // la misma oferta se reemplaza entera: 5 filas entran aunque ya había 3 de esa oferta
    await expect(saveForm(j1, form(5), l)).resolves.toMatchObject({ saved: 5, replaced: 3 });
  });

  it("por encima del tope de bytes devuelve cuota_respuestas", async () => {
    const j1 = await seedJob(A, "b1");
    const j2 = await seedJob(A, "b2");
    const l = limits({ formBytes: 1_000 });
    await saveForm(j1, form(2, 200), l);
    await expect(saveForm(j2, form(2, 400), l)).rejects.toBeInstanceOf(PersonQuotaError);
  });
});

describe("el conteo usa índice (miles de filas, con ANALYZE)", () => {
  /** Plan de una consulta de drizzle, sin ejecutarla. */
  async function plan(q: { toSQL: () => { sql: string; params: unknown[] } }): Promise<string> {
    const { sql: text, params } = q.toSQL();
    const rows = await conn.sql.unsafe(`explain ${text}`, params as never[]);
    return rows.map((r) => String(r["QUERY PLAN"])).join("\n");
  }

  beforeAll(async () => {
    const others = Array.from(
      { length: 50 },
      (_, i) => `c4200000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const rows = Array.from({ length: 6000 }, (_, i) =>
      blob(others[i % 50]!, i % 3 ? "jd_pegada" : "inbound_email", 100),
    );
    for (let i = 0; i < rows.length; i += 1000) {
      await conn.db.insert(s.rawBlobs).values(rows.slice(i, i + 1000));
    }
    await conn.db.insert(s.rawBlobs).values([blob(A, "jd_pegada", 100)]);
    const answers = Array.from({ length: 3000 }, (_, i) => ({
      userId: others[i % 50]!,
      question: `P ${i}`,
      questionNormalized: `p ${i}`,
      answer: "r",
      lang: "es",
    }));
    for (let i = 0; i < answers.length; i += 1000) {
      await conn.db.insert(s.answerBank).values(answers.slice(i, i + 1000));
    }
    // Mil ofertas de otras personas con tres respuestas de formulario cada una
    const jobRows = Array.from({ length: 1000 }, (_, i) => ({
      userId: others[i % 50]!,
      title: `Puesto ${i}`,
      titleNormalized: `puesto ${i}`,
      companyRaw: "Empresa A",
    }));
    const jobIds: { id: string; userId: string }[] = [];
    for (let i = 0; i < jobRows.length; i += 500) {
      jobIds.push(
        ...(await conn.db
          .insert(s.jobs)
          .values(jobRows.slice(i, i + 500))
          .returning({ id: s.jobs.id, userId: s.jobs.userId })),
      );
    }
    const formRows = jobIds.flatMap((j) =>
      [0, 1, 2].map((position) => ({
        userId: j.userId,
        jobId: j.id,
        position,
        question: "Pregunta",
        answer: "Respuesta",
      })),
    );
    for (let i = 0; i < formRows.length; i += 1000) {
      await conn.db.insert(s.applicationAnswers).values(formRows.slice(i, i + 1000));
    }
    for (const table of ["raw_blobs", "answer_bank", "jobs", "application_answers"]) {
      await conn.sql.unsafe(`analyze ${table}`);
    }
  }, 120_000);

  afterAll(async () => {
    await conn.sql.unsafe("delete from raw_blobs where user_id::text like 'c4200000%'");
    await conn.sql.unsafe("delete from answer_bank where user_id::text like 'c4200000%'");
    await conn.sql.unsafe("delete from jobs where user_id::text like 'c4200000%'");
  });

  it("la suma de bytes de raw_blobs no recorre toda la tabla", async () => {
    expect(await plan(personRawBytesQuery(conn.db, A))).not.toMatch(/Seq Scan on raw_blobs/);
  });

  it("el conteo de answer_bank no recorre toda la tabla", async () => {
    expect(await plan(answerBankUsageQuery(conn.db, A))).not.toMatch(/Seq Scan on answer_bank/);
  });

  it("el conteo de application_answers entra por jobs y por el índice de la oferta", async () => {
    const q = applicationAnswersUsageQuery(conn.db, A, "00000000-0000-4000-8000-0000000000ff");
    expect(await plan(q)).not.toMatch(/Seq Scan on application_answers/);
  });
});
