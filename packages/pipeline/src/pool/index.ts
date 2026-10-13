export { stripContacts } from "./strip-contacts";
export { parsePoolLimits, POOL_LIMIT_DEFAULTS, POOL_LIMIT_MAX, type PoolLimits } from "./limits";
export { monthlyUsd, HOURS_PER_MONTH } from "./monthly-usd";
export { rankCandidates, interleaveByRole, type RankCandidate } from "./rank";
export * from "./attribution";
export {
  roleGapMessage,
  summarizeRoleGap,
  type RoleGapCause,
  type RoleGapGroup,
  type RoleGapInput,
  type RoleGapSummary,
} from "./role-gaps";
export { roleDemand, type RoleDemandJob, type RoleDemandRow } from "./role-demand";
