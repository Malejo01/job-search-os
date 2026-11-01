// packages/pipeline: funciones puras. No importa db ni adapters, no hace I/O.
export * from "./result";
export * from "./normalize";
export * from "./evaluation";
export * from "./decide";
export * from "./evaluator/injection";
export * from "./evaluator/sanitize";
export * from "./evaluator/checklist";
export * from "./evaluator/job-facts";
export * from "./status";
export * from "./status-correction";
// C-7 #11: lejos de las líneas que tocan otras ramas abiertas (#207)
export * from "./cache-limit";
export * from "./inbox-volume";
export * from "./dedup";
export * from "./prefilter";
export * from "./skills";
export * from "./feedback";
// C-16: en el medio y no al final, para no chocar con los export que agregan otras ramas
export * from "./org";
export * from "./manual-url";
export type { CriteriaRules } from "./criteria";
export { parseModality, rawJobFromManual } from "./raw-job";
export type { ManualJobInput, Modality, RawJob, SourceKind } from "./raw-job";
export * from "./filter-leak";
export * from "./webmail-domains";
export * from "./inbound-classify";
export * from "./inbox-attention";
export * from "./review";
// S-6: en el medio y no al final, para no chocar con los export que agregan otras ramas
export * from "./session-version";
export * from "./applicant";
export * from "./legal/markdown";
export * from "./onboarding";
export * from "./inbound-address";
export * from "./criteria-form";
export * from "./assistant-step";
// Fase 7 etapa 3 (asistente, nube N1): en el medio y no al final, para no chocar con otras ramas
export * from "./agent";
export * from "./product";
export { inferRoleHints, SOURCE_CATEGORY_ROLES } from "./skills/role-hints";
export * from "./pool";
// C-13 y C-14: en el medio y no al final, para no chocar con los export que agregan otras ramas
export * from "./career-maturity";
export * from "./beta-metrics";
export * from "./founder-seats";
export * from "./trust";
export * from "./first-steps";
// N4-4: en el medio y no al final, para no chocar con los export que agregan otras ramas
export * from "./job-priority";
export * from "./first-ingest";
export * from "./demo";
export * from "./cv";
export * from "./cv-chat";
export * from "./cv-out";
export * from "./alerts/portal-guide";
export * from "./applications/followup";
export * from "./alerts/portal-stats";
export * from "./today/visit";
export * from "./plan-access";
export * from "./plans";
export * from "./learning";
export * from "./fit/fit-points";
export * from "./fit/fit-summary";
export * from "./digest/build";
export * from "./brand";
export * from "./public-url";

export * from "./evaluator/skill-level-overlay";
export * from "./evaluator/wire";
export * from "./feedback/beta-feedback";
