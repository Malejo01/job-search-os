// packages/adapters: implementaciones por entorno (llm, queue, storage, cron, sources).
export * from "./llm";
export { createLogger, type Logger } from "./logger";
export { safeDbError, type SafeDbError } from "./logging/safe-error";
// Arriba a propósito: el PR #38 agrega exports al final de este archivo (ronda 04, debate §1).
export * from "./applicant/drafts";
export * from "./sources/getonboard";
export * from "./ingest/ingest-job";
export * from "./ingest/attach-jd";
export * from "./ingest/merge-duplicate";
export * from "./ingest/run-getonboard";
export {
  parseEnabledSources,
  runExtraSourcesIngest,
  type RunExtraSourcesResult,
} from "./ingest/run-sources";
export * from "./queue/pg-queue";
export * from "./worker/evaluate-job";
export * from "./worker/cron-response";
export * from "./market/snapshot";
export * from "./market/plan";
export * from "./market/recompute";
export * from "./skills/sync";
export * from "./storage/blob";
export * from "./inbound/svix";
export * from "./inbound/parsers";
export * from "./inbound/resend";
export * from "./inbound/handle";
export * from "./applications/apply-event";
export * from "./applications/linkedin-application";
export * from "./email/resend";
export * from "./applicant/context";
export * from "./mcp/auth";
export * from "./mcp/untrusted";
export * from "./mcp/schemas";
export * from "./auth/secret";
export * from "./auth/reset-url";
export * from "./auth/reset-tokens";
export * from "./retention/purge";
export {
  parsePoolSources,
  POOL_RECOMMENDED_SOURCES,
  POOL_SOURCE_NAMES,
  runPoolFetch,
  type PoolSourceName,
  type PoolSourceResult,
  type RunPoolFetchResult,
} from "./pool/fetch";
export { upsertPoolJobs, type PoolUpsertSummary } from "./pool/upsert";
export { POOL_RETENTION_DAYS, purgePool } from "./pool/retention";
export { sourceUserAgent } from "./sources/user-agent";
export {
  ATS_PROVIDERS,
  isValidAtsToken,
  type AtsBoardStatus,
  type AtsProvider,
} from "./sources/ats-common";
export { assignPoolToUser, type AssignOptions, type AssignResult } from "./pool/assign";
export { hasPoolEvaluationActivity, loadPoolEvalLimit } from "./pool/usage";
export { explainEmptyRoles } from "./pool/role-coverage";
// Demo guiada (ronda 74): línea en el medio a propósito, el #102 toca las puntas de este archivo.
export * from "./demo";
export { assignPoolDaily, type PoolDailyOptions, type PoolDailyResult } from "./pool/daily";
export {
  CAREER_MARKET_WINDOW_DAYS,
  readCareerMarketInput,
  readCareerSalaryJobs,
} from "./market/career-market";
export {
  buildRoleMarketSnapshots,
  getRoleMarket,
  ROLE_MARKET_WINDOW_DAYS,
  type RoleMarket,
} from "./market/role-snapshot";
