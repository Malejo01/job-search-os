// packages/pipeline: funciones puras. No importa db ni adapters, no hace I/O.
export * from "./result";
export * from "./normalize";
export * from "./evaluation";
export * from "./decide";
export * from "./status";
export * from "./dedup";
export * from "./prefilter";
export * from "./skills";
export * from "./feedback";
export type { CriteriaRules } from "./criteria";
export { parseModality, rawJobFromManual } from "./raw-job";
export type { ManualJobInput, Modality, RawJob, SourceKind } from "./raw-job";
