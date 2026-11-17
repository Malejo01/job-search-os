// Coach de CV (ADR-038): contrato puro, sin I/O (R12-7). Lo implementan R12-8 a R12-11.
// Cada etapa tiene su carpeta con su propio index: un ticket no toca el archivo de otro.
export * from "./flag";
export * from "./issues";
export * from "./limits";
export * from "./routes";
export * from "./schemas";
export * from "./review";
export * from "./turn";
export * from "./close";
