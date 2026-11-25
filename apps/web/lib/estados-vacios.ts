import type { MascotaPose } from "./mascota";

/**
 * Qué pose de la mascota acompaña a un estado vacío o de error (R23-07, R27-05). Módulo puro, sin I/O: lo
 * lee el componente `<EstadoMarca>`. Con las nueve poses reales ya no hay ilustración ni monograma de
 * respaldo: todo vacío lleva a la mascota. Cada pantalla puede pedir otra pose (`pose` de `<EstadoMarca>`),
 * por ejemplo `trabajando` en Match.
 */
export const ESTADOS_TIPOS = [
  "lista-vacia",
  "sin-resultados",
  "sin-datos",
  "postulaciones",
  "sin-descripcion",
  "cv",
  "error",
] as const;
export type EstadoTipo = (typeof ESTADOS_TIPOS)[number];

const POSE_POR_TIPO: Readonly<Record<EstadoTipo, MascotaPose>> = {
  "lista-vacia": "quieto",
  "sin-resultados": "quieto",
  "sin-datos": "quieto",
  // Tracker: mira tus postulaciones con la tablet
  postulaciones: "analizando",
  "sin-descripcion": "pensando",
  // Diagnóstico del CV: explica con el gráfico
  cv: "explicando",
  // «Lo estamos revisando»
  error: "analizando",
};

/** La pose de un estado: la que pide la pantalla o, si no pide ninguna, la del tipo. */
export function poseDeEstado(tipo: EstadoTipo, pose?: MascotaPose): MascotaPose {
  return pose ?? POSE_POR_TIPO[tipo];
}
