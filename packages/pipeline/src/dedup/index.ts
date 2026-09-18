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
  fnv1a,
  jaccard,
  shingleSimilarity,
  shingles,
  SKETCH_SIZE,
  textShingles,
  words,
} from "./similarity";
