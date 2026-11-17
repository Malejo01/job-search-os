// Agente de perfil desde el CV (ADR-034): contrato puro, sin I/O. Lo implementan R10-1 a R10-6.
// Cada etapa tiene su carpeta con su propio index: un ticket no toca el archivo de otro.
export * from "./flag";
export * from "./access";
export * from "./limits";
export * from "./schemas";
export * from "./routes";
export * from "./screen";
export * from "./sensitive";
export * from "./ticket";
export * from "./read";
export * from "./gaps";
export * from "./guide";
export * from "./close";
