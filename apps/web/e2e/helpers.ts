// Sin @job-search-os/db: su env.ts usa import.meta y Playwright transpila a CJS. Solo schema,
// postgres y los helpers de contraseña (password.ts y password-reset-token.ts solo usan node:crypto).
import * as s from "@job-search-os/db/schema";
import { hashPassword } from "@job-search-os/db/password";
import { generateResetToken } from "@job-search-os/db/password-reset-token";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
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
  /** `aplicada`: ya tiene una acción tomada; la lista sin revisar (JS-061) no la muestra. */
  status: "pendiente_jd" | "evaluada" | "prefiltrada" | "aplicada";
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
/**
 * Evaluación falsa. Por defecto score 7 y `aplicar` (lo que asumen los flujos viejos); JS-061
 * necesita scores altos para ordenar sus ofertas arriba de todo y acciones que no sean verdes.
 */
export async function createEvaluation(
  jobId: string,
  options: { score?: number; accion?: "aplicar" | "guardar" | "descartar" } = {},
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.evaluations).values({
      jobId,
      userId: E2E_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score: options.score ?? 7,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: "Evaluación de prueba (e2e).",
      accion: options.accion ?? "aplicar",
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
  /** Fecha de llegada (por defecto, ahora). */
  receivedAt?: Date;
  /** Llega de un remitente no esperado: sin cuerpo guardado (JS-051). */
  redacted?: boolean;
  /** Avisos que el parser extrajo (por defecto 0). */
  jobsExtracted?: number;
  /** Llega ya visto (lo que hace la ingesta con un email que extrajo avisos). */
  seen?: boolean;
}): Promise<{ id: string; rawRef: string }> {
  const { db, close } = ownerDb();
  try {
    const body = JSON.stringify(
      options.redacted
        ? {
            event: { data: { subject: options.subject } },
            content: null,
            redacted:
              "remitente no esperado: por privacidad se guardó solo remitente, asunto y fecha, sin el cuerpo",
          }
        : {
            event: { data: { subject: options.subject } },
            content: {
              text: options.text === undefined ? "hola" : options.text,
              html: options.html ?? null,
            },
          },
    );
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
        jobsExtracted: options.jobsExtracted ?? 0,
        error:
          options.error === undefined
            ? "sin parser para este remitente: cola manual"
            : options.error,
        receivedAt: options.receivedAt ?? new Date(),
        dismissedAt: options.dismissed ? new Date() : null,
        seenAt: options.seen ? new Date() : null,
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

/** Decisión guardada sobre un dominio remitente (JS-048), o null. */
export async function senderVerdict(domain: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ verdict: s.inboundSenderDomains.verdict })
      .from(s.inboundSenderDomains)
      .where(
        and(
          eq(s.inboundSenderDomains.userId, E2E_USER_ID),
          eq(s.inboundSenderDomains.domain, domain),
        ),
      );
    return row?.verdict ?? null;
  } finally {
    await close();
  }
}

/** Borra las decisiones sobre dominios que contienen `fragment` (limpieza de los e2e). */
export async function clearSenderVerdicts(fragment: string): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .delete(s.inboundSenderDomains)
      .where(sql`${s.inboundSenderDomains.domain} like ${`%${fragment}%`}`);
  } finally {
    await close();
  }
}

// ─────────────────────────────────────────────────────────────
// Segundo usuario (B) para los e2e de dos usuarios (JS-098). Datos inventados; el usuario de
// siempre (E2E_USER_ID) hace de A. Todo se crea como dueño y se borra con removeSecondUser().
// ─────────────────────────────────────────────────────────────
export const E2E_B_EMAIL = "usuario-b@dos.test";
export const E2E_B_PASSWORD = "dev-password-b-local";
export const E2E_B_USER_ID = "b0000000-0000-4000-8000-000000000002";

export type SecondUserData = {
  jobId: string;
  title: string;
  company: string;
  /** Texto único dentro de la JD de B: no tiene que aparecer en ninguna pantalla de A. */
  jdToken: string;
  applicationId: string;
  emailId: string;
  rawRef: string;
  subject: string;
  /** Dominio remitente del email de B, con una decisión guardada (`no_empleo`). */
  domain: string;
};

/** Crea a B con onboarding completo (si no, el layout lo manda a /onboarding). Idempotente. */
export async function ensureSecondUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.users)
      .values({
        id: E2E_B_USER_ID,
        email: E2E_B_EMAIL,
        name: "Persona B",
        passwordHash: hashPassword(E2E_B_PASSWORD),
      })
      .onConflictDoNothing();
    await db
      .insert(s.profiles)
      .values({
        userId: E2E_B_USER_ID,
        displayName: "Persona B",
        locationCountry: "AR",
        inboundAddress: "u_dos_b@ingest.test",
        profileSummary:
          "Perfil ficticio de la persona B para los tests de dos usuarios. No corresponde a nadie real y solo existe en la base local.",
      })
      .onConflictDoNothing();
    const [crit] = await db
      .select({ id: s.evaluationCriteria.id })
      .from(s.evaluationCriteria)
      .where(eq(s.evaluationCriteria.userId, E2E_B_USER_ID));
    if (!crit) {
      await db
        .insert(s.evaluationCriteria)
        .values({ userId: E2E_B_USER_ID, version: 1, active: true, rules: {} as never });
    }
  } finally {
    await close();
  }
}

/** Una oferta evaluada, una postulación, un email entrante con su crudo y un dominio, todo de B. */
export async function seedSecondUserData(tag: string | number): Promise<SecondUserData> {
  await ensureSecondUser();
  const { db, close } = ownerDb();
  try {
    const title = `Oferta Ficticia B ${tag}`;
    const company = `Empresa B ${tag}`;
    const jdToken = `TokenJdFicticioB${tag}`;
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: E2E_B_USER_ID,
        companyRaw: company,
        title,
        titleNormalized: title.toLowerCase(),
        canonicalUrl: `https://example.com/e2e-b/${tag}`,
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        status: "evaluada",
        jdText: `Descripción ficticia de la oferta de B. ${jdToken}`,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    await db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "manual",
      sourceName: "e2e-b",
      url: `https://example.com/e2e-b/${tag}`,
      seenAt: new Date(),
    });
    await db.insert(s.evaluations).values({
      jobId: job!.id,
      userId: E2E_B_USER_ID,
      criteriaVersion: 1,
      promptVersion: "evaluate_job@e2e",
      model: "fake",
      hadFullJd: true,
      score: 8,
      locationOk: "ok",
      modality: "remoto",
      discipline: "ai_engineer",
      matchFuerte: [],
      gaps: [],
      bloqueadoresDuros: [],
      senalesPositivas: [],
      veredicto: `Evaluación ficticia de B ${tag}.`,
      accion: "aplicar",
    });
    const [application] = await db
      .insert(s.applications)
      .values({
        jobId: job!.id,
        userId: E2E_B_USER_ID,
        appliedAt: new Date(),
        outcome: "sin_respuesta",
      })
      .returning({ id: s.applications.id });

    const subject = `Email ficticio de B ${tag}`;
    const domain = `dominio-b-${tag}.example`;
    const body = JSON.stringify({
      event: { data: { subject } },
      content: { text: `Cuerpo ficticio de B ${tag}`, html: null },
    });
    const [blob] = await db
      .insert(s.rawBlobs)
      .values({
        userId: E2E_B_USER_ID,
        kind: "inbound_email",
        contentType: "application/json",
        body,
        bytes: body.length,
      })
      .returning({ id: s.rawBlobs.id });
    const rawRef = `pg:${blob!.id}`;
    const [email] = await db
      .insert(s.inboundEmails)
      .values({
        userId: E2E_B_USER_ID,
        fromAddress: `Remitente B <aviso@mail.${domain}>`,
        subject,
        rawRef,
        parser: "none",
        jobsExtracted: 0,
        error: "sin parser para este remitente: cola manual",
        receivedAt: new Date(),
      })
      .returning({ id: s.inboundEmails.id });
    await db
      .insert(s.inboundSenderDomains)
      .values({ userId: E2E_B_USER_ID, domain, verdict: "no_empleo" });
    return {
      jobId: job!.id,
      title,
      company,
      jdToken,
      applicationId: application!.id,
      emailId: email!.id,
      rawRef,
      subject,
      domain,
    };
  } finally {
    await close();
  }
}

/** Borra todo lo de B (ofertas con sus hijos por cascade, emails, crudos, dominios) y su cuenta. */
export async function removeSecondUser(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.inboundSenderDomains).where(eq(s.inboundSenderDomains.userId, E2E_B_USER_ID));
    await db.delete(s.inboundEmails).where(eq(s.inboundEmails.userId, E2E_B_USER_ID));
    await db.delete(s.rawBlobs).where(eq(s.rawBlobs.userId, E2E_B_USER_ID));
    await db.delete(s.applications).where(eq(s.applications.userId, E2E_B_USER_ID));
    await db.delete(s.evaluations).where(eq(s.evaluations.userId, E2E_B_USER_ID));
    await db.delete(s.jobs).where(eq(s.jobs.userId, E2E_B_USER_ID));
    await db.delete(s.evaluationCriteria).where(eq(s.evaluationCriteria.userId, E2E_B_USER_ID));
    await db.delete(s.profiles).where(eq(s.profiles.userId, E2E_B_USER_ID));
    await db.delete(s.users).where(eq(s.users.id, E2E_B_USER_ID));
  } finally {
    await close();
  }
}

/** Inicia sesión como B. */
export async function loginAsSecondUser(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(E2E_B_EMAIL);
  await page.getByLabel("Contraseña").fill(E2E_B_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL("**/jobs**");
}

/** Postulación del usuario seed (A) para una oferta suya; devuelve el id. */
export async function createApplicationForSeedUser(jobId: string): Promise<string> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .insert(s.applications)
      .values({ jobId, userId: E2E_USER_ID, appliedAt: new Date(), outcome: "sin_respuesta" })
      .returning({ id: s.applications.id });
    return row!.id;
  } finally {
    await close();
  }
}

/** Resultado de una postulación por su id (null si no existe). */
export async function applicationOutcomeById(id: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ outcome: s.applications.outcome })
      .from(s.applications)
      .where(eq(s.applications.id, id));
    return row?.outcome ?? null;
  } finally {
    await close();
  }
}

/** Decisión guardada sobre un dominio para un usuario cualquiera, o null. */
export async function senderVerdictOf(userId: string, domain: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [row] = await db
      .select({ verdict: s.inboundSenderDomains.verdict })
      .from(s.inboundSenderDomains)
      .where(
        and(eq(s.inboundSenderDomains.userId, userId), eq(s.inboundSenderDomains.domain, domain)),
      );
    return row?.verdict ?? null;
  } finally {
    await close();
  }
}

/** Cuántos emails de un dominio remitente tiene un usuario (para verificar que no se borraron). */
export async function inboundCountOf(userId: string, subjectFragment: string): Promise<number> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(
        and(
          eq(s.inboundEmails.userId, userId),
          sql`${s.inboundEmails.subject} like ${`%${subjectFragment}%`}`,
        ),
      );
    return rows.length;
  } finally {
    await close();
  }
}

/** Guarda una decisión sobre un dominio para el usuario seed (la UI de Remitentes la cambia después). */
export async function setSenderVerdictForSeed(
  domain: string,
  verdict: "empleo" | "no_empleo",
): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db
      .insert(s.inboundSenderDomains)
      .values({ userId: E2E_USER_ID, domain, verdict })
      .onConflictDoUpdate({
        target: [s.inboundSenderDomains.userId, s.inboundSenderDomains.domain],
        set: { verdict },
      });
  } finally {
    await close();
  }
}

/** Dirección de ingesta del usuario seed; devuelve la anterior para restaurarla al final. */
export async function setSeedInboundAddress(address: string): Promise<string | null> {
  const { db, close } = ownerDb();
  try {
    const [before] = await db
      .select({ address: s.profiles.inboundAddress })
      .from(s.profiles)
      .where(eq(s.profiles.userId, E2E_USER_ID));
    await db
      .update(s.profiles)
      .set({ inboundAddress: address })
      .where(eq(s.profiles.userId, E2E_USER_ID));
    return before?.address ?? null;
  } finally {
    await close();
  }
}

export type AssistantFactsBackup = {
  id: string;
  parser: string | null;
  jobsExtracted: number | null;
}[];

/**
 * Deja al usuario seed sin pedidos de Gmail ni alertas con avisos (los hechos del asistente), para
 * partir del paso 1. Devuelve lo que cambió, para `restoreAssistantFacts`.
 */
export async function neutralizeAssistantFacts(): Promise<AssistantFactsBackup> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({
        id: s.inboundEmails.id,
        parser: s.inboundEmails.parser,
        jobsExtracted: s.inboundEmails.jobsExtracted,
      })
      .from(s.inboundEmails)
      .where(
        and(
          eq(s.inboundEmails.userId, E2E_USER_ID),
          sql`(${s.inboundEmails.parser} = 'gmail_reenvio' or ${s.inboundEmails.jobsExtracted} > 0)`,
        ),
      );
    // Un solo UPDATE: o cambia todo lo respaldado o nada
    if (rows.length > 0) {
      await db
        .update(s.inboundEmails)
        .set({ parser: "none", jobsExtracted: 0 })
        .where(
          inArray(
            s.inboundEmails.id,
            rows.map((r) => r.id),
          ),
        );
    }
    return rows;
  } finally {
    await close();
  }
}

export async function restoreAssistantFacts(backup: AssistantFactsBackup): Promise<void> {
  const { db, close } = ownerDb();
  try {
    for (const r of backup) {
      await db
        .update(s.inboundEmails)
        .set({ parser: r.parser, jobsExtracted: r.jobsExtracted })
        .where(eq(s.inboundEmails.id, r.id));
    }
  } finally {
    await close();
  }
}

// ─────────────────────────────────────────────────────────────
// Skills autodeclaradas (ronda 28). Datos inventados; se borran con deleteUserData o con el usuario.
// ─────────────────────────────────────────────────────────────

/**
 * Siembra ofertas evaluadas de un usuario con sus skills pedidas (job_skills, todas requeridas).
 * Cada elemento de `offers` es la lista de slugs de una oferta. Devuelve los ids de las ofertas.
 */
export async function seedOffersWithSkills(
  userId: string,
  tag: string | number,
  offers: string[][],
): Promise<string[]> {
  const { db, close } = ownerDb();
  try {
    const slugs = [...new Set(offers.flat())];
    const known = await db
      .select({ id: s.skills.id, slug: s.skills.slug })
      .from(s.skills)
      .where(inArray(s.skills.slug, slugs));
    const idOf = new Map(known.map((k) => [k.slug, k.id]));
    const ids: string[] = [];
    for (const [i, list] of offers.entries()) {
      const title = `Oferta Ficticia Skills ${tag} ${i + 1}`;
      const [job] = await db
        .insert(s.jobs)
        .values({
          userId,
          companyRaw: `Empresa Skills ${tag} ${i + 1}`,
          title,
          titleNormalized: title.toLowerCase(),
          canonicalUrl: `https://example.com/e2e-skills/${tag}/${i + 1}`,
          locationRaw: "Remoto (Brasil)",
          modality: "remoto",
          status: "evaluada",
          jdText: `Descripción ficticia de la oferta ${i + 1} (${tag}).`,
          flags: [],
          firstSeenAt: new Date(),
        })
        .returning({ id: s.jobs.id });
      await db.insert(s.evaluations).values({
        jobId: job!.id,
        userId,
        criteriaVersion: 1,
        promptVersion: "evaluate_job@e2e",
        model: "fake",
        hadFullJd: true,
        score: 8,
        locationOk: "ok",
        modality: "remoto",
        discipline: "fullstack",
        matchFuerte: [],
        gaps: [],
        bloqueadoresDuros: [],
        senalesPositivas: [],
        veredicto: "Evaluación de prueba (e2e).",
        accion: "aplicar",
      });
      const rows = list.flatMap((slug) => {
        const skillId = idOf.get(slug);
        return skillId ? [{ jobId: job!.id, skillId, isMust: true, rawMention: slug }] : [];
      });
      if (rows.length !== list.length) throw new Error("un slug de la oferta no está en skills");
      await db.insert(s.jobSkills).values(rows);
      ids.push(job!.id);
    }
    return ids;
  } finally {
    await close();
  }
}

/**
 * Siembra el snapshot de mercado de la semana actual (lunes UTC) para los slugs de `offers`, como
 * lo calcularía el recálculo: menciones = ofertas que la piden, todas como requisito, demanda =
 * 8 por mención (el score de las ofertas sembradas). Así el spec no espera a la primera ingesta.
 */
export async function seedMarketSnapshot(userId: string, offers: string[][]): Promise<void> {
  const { db, close } = ownerDb();
  try {
    const mentions = new Map<string, number>();
    for (const list of offers)
      for (const slug of list) mentions.set(slug, (mentions.get(slug) ?? 0) + 1);
    const known = await db
      .select({ id: s.skills.id, slug: s.skills.slug })
      .from(s.skills)
      .where(inArray(s.skills.slug, [...mentions.keys()]));
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const weekStart = d.toISOString().slice(0, 10);
    await db
      .insert(s.marketSnapshots)
      .values(
        known.map((k) => ({
          userId,
          weekStart,
          skillId: k.id,
          mentions: mentions.get(k.slug)!,
          mustMentions: mentions.get(k.slug)!,
          weightedDemand: 8 * mentions.get(k.slug)!,
        })),
      )
      .onConflictDoNothing();
  } finally {
    await close();
  }
}

/** slug → nivel declarado de un usuario. */
export async function skillLevelsOf(userId: string): Promise<Record<string, number>> {
  const { db, close } = ownerDb();
  try {
    const rows = await db
      .select({ slug: s.skills.slug, level: s.skillLevels.level })
      .from(s.skillLevels)
      .innerJoin(s.skills, eq(s.skills.id, s.skillLevels.skillId))
      .where(eq(s.skillLevels.userId, userId));
    return Object.fromEntries(rows.map((r) => [r.slug, r.level]));
  } finally {
    await close();
  }
}
