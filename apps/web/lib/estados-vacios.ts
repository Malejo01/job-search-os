import type { IllustrationScene } from "@job-search-os/pipeline";
import { MASCOTA_DISPONIBLE, type MascotaImagen } from "./mascota";

/**
 * Qué se dibuja en un estado vacío o de error (R23-07). Módulo puro, sin I/O: lo lee el componente
 * `<EstadoMarca>`. Prioridad: la mascota (cuando exista la pose), después la ilustración de la escena,
 * después el monograma. Así el lugar de la mascota queda listo y nada salta cuando lleguen los PNG.
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

export type EstadoVisual =
  | { kind: "mascota"; pose: MascotaImagen }
  | { kind: "ilustracion"; escena: IllustrationScene }
  | { kind: "monograma" };

const POR_TIPO: Readonly<
  Record<EstadoTipo, { pose: MascotaImagen; escena: IllustrationScene | null }>
> = {
  "lista-vacia": { pose: "quieta", escena: "vacio" },
  "sin-resultados": { pose: "pensando", escena: null },
  "sin-datos": { pose: "quieta", escena: null },
  postulaciones: { pose: "quieta", escena: "postulaciones" },
  "sin-descripcion": { pose: "pensando", escena: "sin-descripcion" },
  cv: { pose: "quieta", escena: "cv" },
  error: { pose: "pensando", escena: "error" },
};

export function visualDeEstado(
  tipo: EstadoTipo,
  mascotaDisponible: Record<MascotaImagen, boolean> = MASCOTA_DISPONIBLE,
): EstadoVisual {
  const { pose, escena } = POR_TIPO[tipo];
  if (mascotaDisponible[pose]) return { kind: "mascota", pose };
  return escena ? { kind: "ilustracion", escena } : { kind: "monograma" };
}
