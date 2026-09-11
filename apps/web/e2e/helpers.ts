// Sin @job-search-os/db: su env.ts usa import.meta y Playwright transpila a CJS. Solo schema + postgres.
import * as s from "@job-search-os/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
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
        canonicalUrl: `https://example.com/e2e/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      url: `https://example.com/e2e/${job!.id}`,
      seenAt: new Date(),
    });
    return job!.id;
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

/** Corre el worker en modo demo contra la cola local (sin LLM). */
export function runDemoWorker(): string {
  return execSync("pnpm worker:evaluate --local --demo --limit 10", {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, LOG_LEVEL: "warn" },
    timeout: 120_000,
  });
}
