import { schema as s, type Db } from "@job-search-os/db";
import { textShingles, type Term } from "@job-search-os/pipeline";
import { and, eq } from "drizzle-orm";
import { loadTaxonomy, syncJobSkillsFromText } from "../skills/sync";
import { pgBlobStorage, type BlobStorage } from "../storage/blob";
import { jdHash } from "./ingest-job";

export type AttachJdInput = {
  userId: string;
  jobId: string;
  /** El texto tal como se pegó; se normaliza para jobs.jd_text y se guarda crudo aparte. */
  text: string;
  storage?: BlobStorage;
  taxonomy?: readonly Term[];
  /** Encola la evaluación (JS-013). Si no está, el job queda con JD pero sin encolar. */
  enqueueEvaluation?: (jobId: string, userId: string) => Promise<void>;
  now?: () => Date;
};

/** Normalización del JD pegado: saltos de línea de Windows y bordes. */
export function normalizePastedJd(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/**
 * JD pegado en la cola de pendientes (JS-017). El texto tal cual se pegó va primero a raw_blobs
 * y queda enlazado en una fuente propia ("JD pegada"), así nunca depende solo de jobs.jd_text
 * (JS-024). Después: texto, hash y shingles en el job, skills desde la JD y cola de evaluación.
 */
export async function attachJdText(db: Db, input: AttachJdInput): Promise<void> {
  const { userId, jobId, text } = input;
  const now = input.now?.() ?? new Date();
  const jd = normalizePastedJd(text);
  const rawRef = await (input.storage ?? pgBlobStorage(db)).put({
    userId,
    kind: "jd_pegada",
    contentType: "text/plain",
    body: text,
  });
  const updated = await db
    .update(s.jobs)
    .set({ jdText: jd, jdHash: jdHash(jd), jdShingles: textShingles(jd), updatedAt: now })
    .where(and(eq(s.jobs.id, jobId), eq(s.jobs.userId, userId)))
    .returning({ id: s.jobs.id });
  if (!updated.length) throw new Error("oferta inexistente");
  await db.insert(s.jobSources).values({
    jobId,
    kind: "manual",
    sourceName: "JD pegada",
    externalId: null,
    url: null,
    rawRef,
    seenAt: now,
  });
  // Skills desde la JD (pre-score offline y mercado), sin LLM
  await syncJobSkillsFromText(db, jobId, jd, input.taxonomy ?? (await loadTaxonomy(db)));
  await input.enqueueEvaluation?.(jobId, userId);
}
