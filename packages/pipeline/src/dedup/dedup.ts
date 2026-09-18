import { jaccard, shingleSimilarity } from "./similarity";

/**
 * Dedup determinista (ADR-006, criterio de fusión revisado por ADR-013), antes del prefiltro y
 * sin LLM. Solo fusiona cuando algo identifica al aviso, no por parecido de nombre:
 * 1. Clave fuerte: misma canonical_url, mismo external_id de la misma fuente o mismo hash del JD
 *    → merge.
 * 2. Texto: JD en ambos con similitud de shingles ≥ 0.9 → merge aunque el título difiera,
 *    con flag volume_recruiting (caso golden 19/20).
 * 3. Empresa normalizada igual + Jaccard de título ≥ 0.6 + ventana de 14 días, sin URL ni JD que
 *    lo confirmen → insert marcado como posible duplicado (`possibleDuplicateOf`). Ya no fusiona:
 *    una consultora publica varios "Senior X Engineering (área)" que normalizan igual (ADR-013).
 *    Si los dos traen JD y el texto no llega al umbral, el texto desmiente al título y no se marca.
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
  /** Hash del JD normalizado (jobs.jd_hash); null si no hay JD */
  jdHash?: string | null;
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
  jdHash?: string | null;
  firstSeenAt: Date | string;
};

export type DedupReason = "url" | "external_id" | "jd_hash" | "jd_text";

export type PossibleDuplicate = { jobId: string; reason: "company_title"; similarity: number };

export type DedupDecision =
  | { kind: "merge"; jobId: string; reason: DedupReason; similarity: number; flags: string[] }
  | { kind: "insert"; possibleDuplicateOf?: PossibleDuplicate };

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
    if (candidate.jdHash && job.jdHash === candidate.jdHash) {
      return { kind: "merge", jobId: job.id, reason: "jd_hash", similarity: 1, flags: [] };
    }
  }

  // 2 y 3. Dentro de la ventana: el texto fusiona; empresa+título solo marca
  const seenAt = toMs(candidate.seenAt);
  let best: Extract<DedupDecision, { kind: "merge" }> | null = null;
  let hint: PossibleDuplicate | null = null;
  for (const job of recentJobs) {
    if (Math.abs(seenAt - toMs(job.firstSeenAt)) > opt.windowDays * DAY_MS) continue;

    const bothHaveJd = Boolean(candidate.jdShingles?.length && job.jdShingles?.length);
    const textSim = bothHaveJd ? shingleSimilarity(candidate.jdShingles!, job.jdShingles!) : 0;
    if (bothHaveJd && textSim >= opt.textThreshold && (!best || textSim > best.similarity)) {
      best = {
        kind: "merge",
        jobId: job.id,
        reason: "jd_text",
        similarity: textSim,
        flags: ["volume_recruiting"],
      };
    }

    if (!bothHaveJd && job.companyNormalized === candidate.companyNormalized) {
      const titleSim = jaccard(candidate.titleTokens, job.titleTokens);
      if (titleSim >= opt.titleThreshold && (!hint || titleSim > hint.similarity)) {
        hint = { jobId: job.id, reason: "company_title", similarity: titleSim };
      }
    }
  }
  if (best) return best;
  return hint ? { kind: "insert", possibleDuplicateOf: hint } : { kind: "insert" };
}
