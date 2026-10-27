// La validación vive en el pipeline (puro y con tests); acá solo se reexporta para la app.
export {
  HISTORY_BULLET_MAX_CHARS,
  HISTORY_ERROR_MESSAGES,
  HISTORY_FIELD_MAX_CHARS,
  HISTORY_KINDS,
  HISTORY_KIND_LABELS,
  HISTORY_MAX_BULLETS,
  HISTORY_MAX_ENTRIES,
  isHistoryField,
  parseBullets,
  validateHistory,
} from "@job-search-os/pipeline";
export type {
  HistoryCheck,
  HistoryField,
  HistoryInput,
  HistoryKind,
} from "@job-search-os/pipeline";
