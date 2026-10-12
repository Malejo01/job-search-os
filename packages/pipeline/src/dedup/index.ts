export {
  DEDUP_DEFAULTS,
  dedup,
  externalKey,
  type DedupCandidate,
  type DedupDecision,
  type DedupOptions,
  type DedupReason,
  type PossibleDuplicate,
  type RecentJob,
} from "./dedup";
export {
  poolDedup,
  type PoolDedupCandidate,
  type PoolDedupDecision,
  type PoolDedupOptions,
  type PoolRecent,
} from "./pool-dedup";
export {
  fnv1a,
  jaccard,
  shingleSimilarity,
  shingles,
  SKETCH_SIZE,
  textShingles,
  words,
} from "./similarity";
export {
  planDuplicateMerge,
  POSSIBLE_DUPLICATE_FLAG,
  type DuplicateCandidate,
  type DuplicateMergeError,
  type DuplicateMergePlan,
} from "./manual-merge";
