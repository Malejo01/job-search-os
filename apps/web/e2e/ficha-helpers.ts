// Ayudas de los e2e de la ficha del aviso (R31, flujos 370-375). Solo base local, datos inventados.
import * as s from "@job-search-os/db/schema";
import { createHash } from "node:crypto";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { E2E_B_USER_ID, ensureSecondUser, ownerDb } from "./helpers";

/**
 * Mismo hash que `jobCardHash` (packages/pipeline/src/job-card/normalize.ts) y `jobs.jd_hash`: sha256 del texto
 * recortado, con los espacios colapsados y en minúsculas. Se repite acá porque Playwright transpila a CJS y no
 * importa el paquete de pipeline.
 */
export const jdHashOf = (text: string): string =>
  createHash("sha256").update(text.trim().replace(/\s+/g, " ").toLowerCase()).digest("hex");

/** Aviso inventado, único por `tag`, con las secciones que lee el modelo simulado. */
export function avisoFicticio(tag: string | number, extra = ""): string {
  return `Empresa E2E busca AI Engineer con experiencia en RAG y agentes (${tag}). Remoto para Argentina y Chile.

Qué vas a hacer
- Diseñar agentes y flujos de recuperación de información con RAG (${tag}).
- Conectar herramientas por MCP.

Requisitos indispensables:
- Manejo de Python.
- Al menos 3 años de experiencia en desarrollo de software.
Deseable:
- Experiencia con TypeScript.

Condiciones
Modalidad remota para personas de Argentina y Chile.
Jornada completa.
${extra}`;
}

/** Una oferta de B (la persona de prueba en la etapa `testers`) con su `jd_hash`, como la deja la ingesta. */
export async function createJobForB(options: {
  title: string;
  jdText: string | null;
  /** Dueña de la oferta; por defecto B. La persona sin rol es `OFF_USER.id` de voz-helpers.ts (hay que llamar antes a `ensureOffUser()`). */
  userId?: string;
  /** `false`: como una oferta anterior a la columna `jd_hash` (queda nulo). */
  withHash?: boolean;
}): Promise<{ jobId: string; hash: string | null }> {
  if (!options.userId) await ensureSecondUser();
  const { db, close } = ownerDb();
  try {
    const hash = options.jdText ? jdHashOf(options.jdText) : null;
    const [job] = await db
      .insert(s.jobs)
      .values({
        userId: options.userId ?? E2E_B_USER_ID,
        companyRaw: "E2E Ficha SA",
        title: options.title,
        titleNormalized: options.title.toLowerCase(),
        canonicalUrl: `https://example.com/e2e-ficha/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        locationRaw: "Remoto (Argentina)",
        modality: "remoto",
        status: "prefiltrada",
        jdText: options.jdText,
        jdHash: options.withHash === false ? null : hash,
        flags: [],
        firstSeenAt: new Date(),
      })
      .returning({ id: s.jobs.id });
    await db.insert(s.jobSources).values({
      jobId: job!.id,
      kind: "email_linkedin",
      sourceName: "e2e",
      url: `https://example.com/e2e-ficha/${job!.id}`,
      seenAt: new Date(),
    });
    return { jobId: job!.id, hash };
  } finally {
    await close();
  }
}

export async function deleteJobsOfB(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobs).where(inArray(s.jobs.id, jobIds));
  } finally {
    await close();
  }
}

/** La fila de la ficha de un texto (o undefined). */
export async function cardRow(hash: string) {
  const { db, close } = ownerDb();
  try {
    const [row] = await db.select().from(s.jobCards).where(eq(s.jobCards.jdHash, hash));
    return row;
  } finally {
    await close();
  }
}

/** Llamadas al modelo (no reservas) que hizo la generación de la ficha de ese texto. */
export async function cardCalls(hash: string) {
  const { db, close } = ownerDb();
  try {
    return await db
      .select()
      .from(s.llmCalls)
      .where(
        and(eq(s.llmCalls.task, "extract_job_card"), eq(s.llmCalls.label, `job_card:${hash}`)),
      );
  } finally {
    await close();
  }
}

/** Borra fichas y registros de ese texto, para que cada spec arranque limpio. */
export async function cleanCards(hashes: (string | null)[]): Promise<void> {
  const list = hashes.filter((h): h is string => !!h);
  if (list.length === 0) return;
  const { db, close } = ownerDb();
  try {
    await db.delete(s.jobCards).where(inArray(s.jobCards.jdHash, list));
    await db
      .delete(s.llmCalls)
      .where(
        or(
          ...list.map((h) => eq(s.llmCalls.label, `job_card:${h}`)),
          like(s.llmCalls.label, "job_card:e2e-%"),
        ),
      );
  } finally {
    await close();
  }
}

/** Gasto ya hecho en fichas en las últimas horas (para llegar al tope diario sin llamar al modelo). */
export async function fakeCardSpend(usd: number): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.insert(s.llmCalls).values({
      userId: null,
      task: "extract_job_card",
      model: "modelo-ficticio",
      label: "job_card:e2e-gasto-previo",
      costUsd: usd,
      ok: true,
      createdAt: new Date(Date.now() - 60_000),
    });
  } finally {
    await close();
  }
}

export async function clearFakeCardSpend(): Promise<void> {
  const { db, close } = ownerDb();
  try {
    await db.delete(s.llmCalls).where(eq(s.llmCalls.label, "job_card:e2e-gasto-previo"));
  } finally {
    await close();
  }
}
