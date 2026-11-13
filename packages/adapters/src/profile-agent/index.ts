// Agente de perfil desde el CV (ADR-034): la parte con I/O. Cada etapa tiene su carpeta y su index:
// un ticket no toca el archivo de otro. `export {}` hasta que el ticket dueño la llene.
export * from "./ticket";
export * from "./read";
export * from "./gaps";
export * from "./guide";
export * from "./close";
