import { seniorityBucket } from "../pool/career/seniority-bucket";

/**
 * «Para empezar» (R30-05): usa la señal de nivel que ya existe, la columna `seniority` del aviso del
 * pool y, si no hay, el nivel que declara el título (`seniorityBucket`). Entra solo lo que dice
 * trainee, pasante o junior (con varios niveles vale el más bajo). Sin señal no entra: no se deduce
 * de los años pedidos ni del sueldo.
 */
export function isEntryLevel(seniority: string | null | undefined, title: string): boolean {
  return seniorityBucket(seniority ?? null, title) === "junior";
}
