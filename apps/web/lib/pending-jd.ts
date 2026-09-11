import {
  createPgQueue,
  enqueueEvaluationWith,
  jdHash,
  loadTaxonomy,
  syncJobSkillsFromText,
} from "@job-search-os/adapters";
import { schema as s } from "@job-search-os/db";
import { textShingles } from "@job-search-os/pipeline";
import { and, desc, eq, isNull } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Cola de ofertas sin descripción (JS-017): las que pasaron el prefiltro pero llegaron sin JD
 * (email de LinkedIn, alerta). La persona lee la JD en el sitio (Claude in Chrome, ≤ 5/día),
 * la pega acá, y el worker de evaluación la toma de job_queue. El estado sigue `pendiente_jd`
 * hasta que el worker aplica `evaluated` (transition), nunca se escribe directo.
 */
export type PendingJdRow = {
  id: string;
  title: string;
  company: string;
  locationRaw: string | null;
  firstSeenAt: string;
  url: string | null;
  sourceKind: string | null;
  flags: string[];
};

export const PENDING_LIMIT = 10;
const MIN_JD_CHARS = 200;

export async function listPendingJd(userId: string): Promise<PendingJdRow[]> {
  return withUser(userId, async (tx) => {
    const jobs = await tx
      .select({
        id: s.jobs.id,
        title: s.jobs.title,
        company: s.jobs.companyRaw,
        locationRaw: s.jobs.locationRaw,
        firstSeenAt: s.jobs.firstSeenAt,
        canonicalUrl: s.jobs.canonicalUrl,
        flags: s.jobs.flags,
      })
      .from(s.jobs)
      // Con JD ya pegada sale de la cola aunque el worker todavía no la haya evaluado (E2E flujo 2)
      .where(and(eq(s.jobs.status, "pendiente_jd"), isNull(s.jobs.jdText)))
      .orderBy(desc(s.jobs.firstSeenAt))
      .limit(PENDING_LIMIT);
    const rows: PendingJdRow[] = [];
    for (const job of jobs) {
      const [src] = await tx
        .select({ kind: s.jobSources.kind, url: s.jobSources.url })
        .from(s.jobSources)
        .where(eq(s.jobSources.jobId, job.id))
        .orderBy(s.jobSources.seenAt)
        .limit(1);
      rows.push({
        id: job.id,
        title: job.title,
        company: job.company,
        locationRaw: job.locationRaw,
        firstSeenAt: job.firstSeenAt.toISOString(),
        url: src?.url ?? job.canonicalUrl,
        sourceKind: src?.kind ?? null,
        flags: job.flags ?? [],
      });
    }
    return rows;
  });
}

export class JdTooShortError extends Error {
  constructor() {
    super(`la descripción tiene que tener al menos ${MIN_JD_CHARS} caracteres`);
    this.name = "JdTooShortError";
  }
}

/** Guarda la JD pegada (texto, hash, shingles) y encola la evaluación. Idempotente en la cola. */
export async function attachJd(userId: string, jobId: string, text: string): Promise<void> {
  const jd = text.replace(/\r\n/g, "\n").trim();
  if (jd.length < MIN_JD_CHARS) throw new JdTooShortError();
  await withUser(userId, async (tx) => {
    const updated = await tx
      .update(s.jobs)
      .set({
        jdText: jd,
        jdHash: jdHash(jd),
        jdShingles: textShingles(jd),
        updatedAt: new Date(),
      })
      .where(eq(s.jobs.id, jobId))
      .returning({ id: s.jobs.id, status: s.jobs.status });
    if (!updated.length) throw new Error("oferta inexistente");
    // Skills desde la JD (pre-score offline y mercado), sin LLM
    await syncJobSkillsFromText(tx, jobId, jd, await loadTaxonomy(tx));
    // Cola con RLS: job_queue.user_id = auth.uid(); el worker (rol dueño) la toma después
    await enqueueEvaluationWith(tx, createPgQueue(tx))(jobId, userId);
  });
}

/** Texto para Claude in Chrome: extraer la JD completa del aviso abierto. */
export const CLAUDE_IN_CHROME_SNIPPET = `Extraé el texto completo de la descripción del puesto de esta página (responsabilidades, requisitos, deseables, beneficios, modalidad y ubicación, salario si aparece). Devolvémelo como texto plano, sin resumir ni comentar, en el idioma original. No apliques ni cliquees nada.`;
