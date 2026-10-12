import type { SourceKind } from "../raw-job";

/**
 * Atribución visible por fuente pública. Cada fuente exige que se la mencione y que se enlace al
 * aviso original (informe de riesgos de fuentes de la ronda 37-38-39). Sin logos: Remote OK los
 * prohíbe sin permiso escrito. `null` = la fuente es propia de la persona (email, manual) y no
 * lleva atribución.
 */
export type SourceAttribution = { name: string; text: string; homeUrl?: string };

export const SOURCE_ATTRIBUTION: Record<SourceKind, SourceAttribution | null> = {
  getonboard_api: { name: "Get on Board", text: "Publicado en Get on Board" },
  email_linkedin: null,
  email_getonboard: null,
  email_generic: null,
  manual: null,
  hn_whoishiring: null,
  remotive: null,
  other: null,
  remoteok: { name: "Remote OK", text: "Publicado en Remote OK" },
  jobicy: { name: "Jobicy", text: "Publicado en Jobicy" },
  himalayas: {
    name: "Himalayas",
    text: "Datos de Himalayas",
    homeUrl: "https://himalayas.app",
  },
};

/** La atribución de una fuente, o null si no lleva (o si el valor no es una fuente conocida). */
export function attributionFor(kind: string): SourceAttribution | null {
  return Object.hasOwn(SOURCE_ATTRIBUTION, kind) ? SOURCE_ATTRIBUTION[kind as SourceKind] : null;
}
