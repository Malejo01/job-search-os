import { trustResponsable } from "@job-search-os/pipeline";

/**
 * Responsable que se muestra en el recuadro de confianza: `LEGAL_RESPONSABLE` leído en cada
 * request (como las páginas legales), nunca en el build. Si falta, un texto neutro. No se loguea.
 */
export function getTrustResponsable(): string {
  return trustResponsable(process.env.LEGAL_RESPONSABLE);
}
