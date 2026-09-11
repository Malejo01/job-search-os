import { jaccard, shingleSimilarity } from "./similarity";

/**
 * Dedup determinista (ADR-006), antes del prefiltro y sin LLM:
 * 1. Clave fuerte: misma canonical_url o mismo external_id de la misma fuente → merge.
 * 2. Clave blanda: misma empresa normalizada + Jaccard de título ≥ 0.6 + ventana de 14 días → merge.
 * 3. Texto: JD en ambos con similitud de shingles ≥ 0.9 → merge aunque el título difiera,
 *    con flag volume_recruiting (caso golden 19/20).
 * 4. Si no, insert (caso golden 6/7: misma empresa, Jaccard < 0.6).
 * Fusionar (lo hace el adapter con la decisión): agregar la fuente a job_sources, conservar
 * la fecha más antigua y el texto más largo.
 */
export type DedupCandidate = {
  canonicalUrl?: string | null;
  sourceKind?: string | null;
  externalId?: string | null;
  /** normalizeCompany(company_raw) */
  companyNormalized: string;
  /** titleTokens(title) */
  titleTokens: readonly string[];
  /** textShingles(jd_text); null si no hay JD */
  jdShingles?: readonly string[] | null;
  /** Fecha de la fuente que trae el candidato (posted_at o ahora). */
  seenAt: Date | string;
};

export type RecentJob = {
  id: string;
  canonicalUrl?: string | null;
  /** `${source_kind}:${external_id}` de cada fuente ya fusionada */
  externalIds?: readonly string[];
  companyNormalized: string;
  titleTokens: readonly string[];
  jdShingles?: readonly string[] | null;
  firstSeenAt: Date | string;
};

export type DedupReason = "url" | "external_id" | "company_title" | "jd_text";

export type DedupDecision =
  | { kind: "merge"; jobId: string; reason: DedupReason; similarity: number; flags: string[] }
  | { kind: "insert" };

export type DedupOptions = {
  windowDays?: number;
  titleThreshold?: number;
  textThreshold?: number;
};

export const DEDUP_DEFAULTS: Required<DedupOptions> = {
  windowDays: 14,
  titleThreshold: 0.6,
  textThreshold: 0.9,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const toMs = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime();

export function externalKey(sourceKind?: string | null, externalId?: string | null): string | null {
  return sourceKind && externalId ? `${sourceKind}:${externalId}` : null;
}

export function dedup(
  candidate: DedupCandidate,
  recentJobs: readonly RecentJob[],
  options: DedupOptions = {},
): DedupDecision {
  const opt = { ...DEDUP_DEFAULTS, ...options };
  const key = externalKey(candidate.sourceKind, candidate.externalId);

  // 1. Claves fuertes
  for (const job of recentJobs) {
    if (candidate.canonicalUrl && job.canonicalUrl === candidate.canonicalUrl) {
      return { kind: "merge", jobId: job.id, reason: "url", similarity: 1, flags: [] };
    }
    if (key && job.externalIds?.includes(key)) {
      return { kind: "merge", jobId: job.id, reason: "external_id", similarity: 1, flags: [] };
    }
  }

  // 2 y 3. Claves blandas dentro de la ventana; se queda con el candidato más parecido
  const seenAt = toMs(candidate.seenAt);
  let best: Extract<DedupDecision, { kind: "merge" }> | null = null;
  for (const job of recentJobs) {
    if (Math.abs(seenAt - toMs(job.firstSeenAt)) > opt.windowDays * DAY_MS) continue;

    if (job.companyNormalized === candidate.companyNormalized) {
      const titleSim = jaccard(candidate.titleTokens, job.titleTokens);
      if (titleSim >= opt.titleThreshold && (!best || titleSim > best.similarity)) {
        best = {
          kind: "merge",
          jobId: job.id,
          reason: "company_title",
          similarity: titleSim,
          flags: [],
        };
      }
    }

    if (candidate.jdShingles?.length && job.jdShingles?.length) {
      const textSim = shingleSimilarity(candidate.jdShingles, job.jdShingles);
      if (textSim >= opt.textThreshold && (!best || textSim > best.similarity)) {
        best = {
          kind: "merge",
          jobId: job.id,
          reason: "jd_text",
          similarity: textSim,
          flags: ["volume_recruiting"],
        };
      }
    }
  }
  return best ?? { kind: "insert" };
}
