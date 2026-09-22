// Sin @job-search-os/db: su env.ts usa import.meta y Playwright transpila a CJS. Solo schema,
// postgres y los helpers de contraseña (password.ts y password-reset-token.ts solo usan node:crypto).
import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { generateResetToken } from "@job-search-os/db/password-reset-token";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { Page } from "@playwright/test";

/** Credenciales del usuario seed local (pnpm db:seed --local con SEED_USER_EMAIL/PASSWORD). */
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "mauro@job-search-os.local";
export const E2E_PASSWORD = process.env.E2E_PASSWORD ?? "dev-password-local";
export const E2E_USER_ID = process.env.E2E_USER_ID ?? "a0000000-0000-4000-8000-000000000001";

const ROOT = resolve(__dirname, "../../..");

/** Conexión como dueño a la base local (Docker o el servicio de CI): solo para preparar datos. */
const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:54322/jobsearch";

export function ownerDb() {
  const sql = postgres(process.env.DATABASE_URL_LOCAL ?? LOCAL_DATABASE_URL, {
    max: 1,
    prepare: false,
  });
  return { db: drizzle(sql, { schema: s }), close: () => sql.end() };
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Contraseña").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/jobs**");
}

/** Inserta una oferta del usuario seed con estado y JD dados; devuelve el id. */
export async function createJob(options: {
  title: string;
  status: "pendiente_jd" | "evaluada" | "prefiltrada";
  jdText?: string | null;
  /** URL de la publicación: `null` = aviso sin link (no debe haber botón "Ver oferta"). */
  canonicalUrl?: string | null;
}): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: E2E_USER_ID,
        companyRaw: "E2E Testing SA",
        title: options.title,
        titleNormalized: options.title.toLowerCase(),
        canonicalUrl:
          options.canonicalUrl === undefined
            ? `https://example.com/e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            : options.canonicalUrl,
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        status: options.status,
        jdText: options.jdText ?? null,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    await db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "email_linkedin",
      sourceName: "e2e",
      url: options.canonicalUrl === null ? null : `https://example.com/e2e/${job!.id}`,
      seenAt: new Date(),
    });
    return job!.id;
  } finally {
    await close();
  }
}

/** Deja la oferta con un mensaje pendiente en la cola de evaluación, como si recién se hubiera pegado el JD. */
export async function enqueueEvaluation(jobId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.jobQueue).values({
      queue: "evaluate_job",
      userId: E2E_USER_ID,
      payload: { jobId },
      runAfter: new Date(),
      maxAttempts: 3,
    });
  } finally {
    await close();
  }
}

/** Estado del mensaje de evaluación de una oferta en job_queue (null si no hay). */
export async function queueStatus(jobId: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ status: s.jobQueue.status })
      .from(s.jobQueue)
      .where(
        and(eq(s.jobQueue.queue, "evaluate_job"), sql`${s.jobQueue.payload}->>'jobId' = ${jobId}`),
      );
    return row?.status ?? null;
  } finally {
    await close();
  }
}

/** Evaluación mínima del modelo demo para una oferta (la corrección de estado exige que exista). */
export async function createEvaluation(jobId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.evaluations).values({
      jobId,
      userId: E2E_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score: 7,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación de prueba (e2e).",
      accion: "aplicar",
    });
  } finally {
    await close();
  }
}

/** Postulación de una oferta (null si no hay). */
export async function applicationOf(jobId: string): Promise<{ outcome: string | null } | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.jobId, jobId));
    return row ?? null;
  } finally {
    await close();
  }
}

/** Email entrante del usuario seed con su crudo en raw_blobs (como lo deja el webhook). */
export async function createInboundEmail(options: {
  subject: string;
  from?: string;
  parser?: string;
  error?: string | null;
  html?: string | null;
  text?: string | null;
  /** Llega ya descartado (ruido social de LinkedIn, JS-050). */
  dismissed?: boolean;
}): Promise<{ id: string; rawRef: string }> {
  const { db, close } = ownerDb();
  try {
    const body = JSON.stringify({
      event: { data: { subject: options.subject } },
      content: {
        text: options.text === undefined ? "hola" : options.text,
        html: options.html ?? null,
      },
    });
    const [blob] = await db
      .insert(s.rawBlobs)
      .values({
        userId: E2E_USER_ID,
        kind: "inbound_email",
        contentType: "application/json",
        body,
        bytes: body.length,
      })
      .returning({ id: s.rawBlobs.id });
    const rawRef = `pg:${blob!.id}`;
    const [row] = await db
      .insert(s.inboundEmails)
      .values({
        userId: E2E_USER_ID,
        fromAddress: options.from ?? "Remitente E2E <e2e@example.com>",
        subject: options.subject,
        rawRef,
        parser: options.parser ?? "none",
        jobsExtracted: 0,
        error:
          options.error === undefined
            ? "sin parser para este remitente: cola manual"
            : options.error,
        receivedAt: new Date(),
        dismissedAt: options.dismissed ? new Date() : null,
      })
      .returning({ id: s.inboundEmails.id });
    return { id: row!.id, rawRef };
  } finally {
    await close();
  }
}

/** Fila de inbound_emails (null si se borró) y si su crudo sigue existiendo. */
export async function inboundState(
  id: string,
  rawRef: string,
): Promise<{ row: { seenAt: Date | null; dismissedAt: Date | null } | null; blob: boolean }> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ seenAt: s.inboundEmails.seenAt, dismissedAt: s.inboundEmails.dismissedAt })
      .from(s.inboundEmails)
      .where(eq(s.inboundEmails.id, id));
    const [blob] = await db
      .select({ id: s.rawBlobs.id })
      .from(s.rawBlobs)
      .where(eq(s.rawBlobs.id, rawRef.replace(/^pg:/, "")));
    return { row: row ?? null, blob: Boolean(blob) };
  } finally {
    await close();
  }
}

/** Hace que una oferta tenga como fuente el crudo de un email (como un aviso extraído de él). */
export async function linkJobToRaw(jobId: string, rawRef: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.update(s.jobSources).set({ rawRef }).where(eq(s.jobSources.jobId, jobId));
  } finally {
    await close();
  }
}

/** Registra emails rechazados por el límite horario en la hora actual. */
export async function addInboundRejections(n: number): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const hour = new Date();
    hour.setUTCMinutes(0, 0, 0);
    await db
      .insert(s.inboundRejections)
      .values({ userId: E2E_USER_ID, windowStart: hour, rejected: n })
      .onConflictDoUpdate({
        target: [s.inboundRejections.userId, s.inboundRejections.windowStart],
        set: { rejected: sql`${s.inboundRejections.rejected} + ${n}` },
      });
  } finally {
    await close();
  }
}

/** Borra los emails de prueba cuyo asunto contiene `fragment`, con sus crudos. */
export async function deleteInboundEmails(fragment: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .delete(s.inboundEmails)
      .where(sql`${s.inboundEmails.subject} like ${`%${fragment}%`}`)
      .returning({ rawRef: s.inboundEmails.rawRef });
    for (const r of rows)
      await db.delete(s.rawBlobs).where(eq(s.rawBlobs.id, r.rawRef.replace(/^pg:/, "")));
  } finally {
    await close();
  }
}

/** Limpia los rechazos del usuario seed (para no afectar otros tests). */
export async function clearInboundRejections(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.inboundRejections).where(eq(s.inboundRejections.userId, E2E_USER_ID));
  } finally {
    await close();
  }
}

export async function jobStatus(jobId: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ status: s.jobs.status })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    return row?.status ?? null;
  } finally {
    await close();
  }
}

export async function deleteJob(jobId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobs).where(eq(s.jobs.id, jobId));
  } finally {
    await close();
  }
}

/** Inserta un token de reset ya vencido/vigente para el usuario seed; devuelve el valor en claro. */
export async function createPasswordResetToken(
  options: { expired?: boolean } = {},
): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const now = options.expired ? new Date(Date.now() - 2 * 60 * 60 * 1000) : new Date();
    const { token, tokenHash, expiresAt } = generateResetToken(now);
    await db.insert(s.passwordResetTokens).values({ userId: E2E_USER_ID, tokenHash, expiresAt });
    return token;
  } finally {
    await close();
  }
}

/** Devuelve la contraseña del usuario seed al valor original (la UI la cambia en el test de reset). */
export async function restoreSeedPassword(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.users)
      .set({ passwordHash: hashPassword(E2E_PASSWORD) })
      .where(eq(s.users.id, E2E_USER_ID));
  } finally {
    await close();
  }
}

/** Corre el worker en modo demo contra la cola local (sin LLM). */
export function runDemoWorker(): string {
  return execSync("pnpm worker:evaluate --local --demo --limit 10", {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, LOG_LEVEL: "warn" },
    timeout: 120_000,
  });
}

/** Marca `dupId` como posible duplicado de `origId`, como lo deja la ingesta (ADR-013). */
export async function markPossibleDuplicate(dupId: string, origId: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .update(s.jobs)
      .set({ duplicateOfId: origId, flags: ["posible_duplicado"] })
      .where(eq(s.jobs.id, dupId));
  } finally {
    await close();
  }
}

/** Estado de una oferta para verificar una fusión: null si se borró. */
export async function jobMergeState(
  jobId: string,
): Promise<{ flags: string[]; duplicateOfId: string | null; sources: number } | null> {
  const { db, close } = ownerDb();
  try {
    const [job] = await db
      .select({ flags: s.jobs.flags, duplicateOfId: s.jobs.duplicateOfId })
      .from(s.jobs)
      .where(eq(s.jobs.id, jobId));
    if (!job) return null;
    const sources = await db
      .select({ id: s.jobSources.id })
      .from(s.jobSources)
      .where(eq(s.jobSources.jobId, jobId));
    return { flags: job.flags ?? [], duplicateOfId: job.duplicateOfId, sources: sources.length };
  } finally {
    await close();
  }
}
