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

/** We Work Remotely pide una suscripción paga para postular; el aviso suele estar gratis en el ATS. */
export const WWR_PAYWALL_NOTICE =
  "We Work Remotely pide una suscripción paga para postular: buscá el aviso en el sitio de empleos de la empresa.";

export type AtsProvider = "greenhouse" | "lever" | "ashby" | "workable";
export type AtsLink = { provider: AtsProvider; url: string };

const ATS_LINKS_MAX = 3;
const ATS_TOKEN_MAX = 2048;
const ATS_URL_MAX = 200;

/** Proveedor de un host/ruta de ATS, o null si no es uno que reconozcamos. Host exacto. */
function atsProviderOf(host: string, path: string): AtsProvider | null {
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") return "greenhouse";
  if (host.endsWith(".greenhouse.io") && /\/jobs\//.test(path)) return "greenhouse";
  if (host === "jobs.lever.co") return "lever";
  if (host === "jobs.ashbyhq.com") return "ashby";
  if (host === "apply.workable.com") return "workable";
  if (host.endsWith(".workable.com") && path.startsWith("/j/")) return "workable";
  return null;
}

/**
 * Links https a avisos de Greenhouse, Lever, Ashby o Workable dentro de un texto. Máximo 3, sin
 * duplicados y en orden de aparición. Solo https, sin credenciales y con host exacto; recorta la
 * puntuación final. Pura: el texto es dato, no se interpreta.
 */
export function findAtsLinks(text: string | null): AtsLink[] {
  if (!text) return [];
  const out: AtsLink[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/https:\/\/[^\s<>"'`]+/gi)) {
    if (out.length >= ATS_LINKS_MAX) break;
    // Se corta antes de podar: la poda con regex sobre un token enorme es cuadrática
    const raw = m[0].slice(0, ATS_TOKEN_MAX).replace(/[.,;:!?)\]}]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) continue;
    const provider = atsProviderOf(parsed.hostname, parsed.pathname);
    if (!provider) continue;
    // Sin query ni hash (pueden llevar tokens de seguimiento) y con largo acotado
    const url = parsed.origin + parsed.pathname;
    if (url.length > ATS_URL_MAX) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ provider, url });
  }
  return out;
}

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
