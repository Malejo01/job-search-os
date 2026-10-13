import type { SourceKind } from "../raw-job";

/**
 * Atribución visible por fuente pública. Cada fuente exige que se la mencione y que se enlace al
 * aviso original (informe de riesgos de fuentes de la ronda 37-38-39). Sin logos: Remote OK los
 * prohíbe sin permiso escrito. `null` = la fuente es propia de la persona (email, manual) y no
 * lleva atribución.
 */
export type SourceAttribution = { name: string; text: string; homeUrl?: string };

const ATS_TEXT = "Publicado en el sitio de empleos de {empresa}";

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
  wwr: { name: "We Work Remotely", text: "Publicado en We Work Remotely" },
  // ATS públicos: el aviso está en el sitio de empleos de la propia empresa; `{empresa}` se
  // reemplaza en `attributionFor` con el nombre de la empresa del aviso.
  greenhouse: { name: "Sitio de empleos", text: ATS_TEXT },
  lever: { name: "Sitio de empleos", text: ATS_TEXT },
  ashby: { name: "Sitio de empleos", text: ATS_TEXT },
};

const ATS_KINDS: ReadonlySet<string> = new Set(["greenhouse", "lever", "ashby"]);
const COMPANY_MAX = 80;

/**
 * La atribución de una fuente, o null si no lleva (o si el valor no es una fuente conocida).
 * En los ATS el texto nombra la empresa del aviso; sin empresa dice "la empresa".
 */
export function attributionFor(
  kind: string,
  opts?: { company?: string | null },
): SourceAttribution | null {
  if (!Object.hasOwn(SOURCE_ATTRIBUTION, kind)) return null;
  const base = SOURCE_ATTRIBUTION[kind as SourceKind];
  if (!base || !ATS_KINDS.has(kind)) return base;
  const company = (opts?.company ?? "").replace(/\s+/g, " ").trim().slice(0, COMPANY_MAX);
  const who = company || "la empresa";
  return { ...base, name: company || base.name, text: base.text.replace("{empresa}", () => who) };
}
