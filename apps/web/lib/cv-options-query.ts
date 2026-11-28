import type { CvOptions } from "./cv-source";

/** Los links del CV (R33-07): tres con nombre propio y un cuarto, «otro», con su etiqueta corta. */
export type CvLinkKey = "linkedin" | "github" | "portfolio" | "otro";
export const CV_LINK_KEYS: readonly CvLinkKey[] = ["linkedin", "github", "portfolio", "otro"];

/**
 * Las opciones del CV como consulta de la URL (`/cv?…` y `/api/cv/<formato>?…`). Sin dependencias de
 * servidor, para que la use el componente de cliente: la vista previa y las dos descargas leen lo mismo.
 * El teléfono viaja solo como marca (`tel=1`, **sin marcar por defecto**): el número nunca va en la URL.
 */
export function cvOptionsQuery(opts: CvOptions): string {
  const flag = (v: boolean | undefined) => (v === false ? "0" : "1");
  return new URLSearchParams({
    lang: opts.lang,
    email: flag(opts.includeEmail),
    basicas: opts.includeBasics ? "1" : "0",
    lugar: flag(opts.includePlace),
    tel: opts.includePhone === true ? "1" : "0",
    linkedin: flag(opts.includeLinks?.linkedin),
    github: flag(opts.includeLinks?.github),
    portfolio: flag(opts.includeLinks?.portfolio),
    otro: flag(opts.includeLinks?.otro),
  }).toString();
}
