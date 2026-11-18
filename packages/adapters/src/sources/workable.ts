import type { RawJob } from "@job-search-os/pipeline";
import {
  atsHtmlToText,
  atsSalary,
  buildAtsRawJob,
  fetchAtsBoard,
  httpUrl,
  joinAtsLocations,
  modalityOfWorkplace,
  text,
  toDate,
  type AtsBoardOptions,
  type AtsBoardResult,
  type AtsMapped,
} from "./ats-common";

/**
 * Workable, widget público de cada cuenta. FORMATO A VERIFICAR con `pool:fetch workable <slug> --dry-run`
 * (no se grabó una respuesta real: ver docs/sources/workable.md). Lo que se asume:
 * - `GET https://apply.workable.com/api/v1/widget/accounts/<slug>?details=true`, sin clave. La URL
 *   pública `workable.com/api/accounts/<slug>` redirige acá: se usa la final y no se sigue ninguna
 *   redirección (`redirect: "error"` en `atsGetBody`).
 * - Respuesta `{ name, jobs: [...] }`. Cada aviso: `title`, `shortcode`, `url` / `shortlink` /
 *   `application_url`, `telecommuting` (boolean), `employment_type`, `department`, `published_on` /
 *   `created_at`, `city` / `state` / `country`, `locations[]` (`city`, `region`, `country`, `hidden`) y
 *   `description` (HTML, con `details=true`).
 * - FALLA CERRADO: sin id, título o link http(s) en `workable.com` el aviso se saltea; una respuesta sin
 *   `jobs` en forma de lista se descarta entera. La ubicación y los países que el widget no dice quedan
 *   `null`; `countriesAllowed` es siempre `null`.
 * - REMOTO: solo cuenta lo que la API declara (`telecommuting === true`). Sin ese dato (o con `false`)
 *   el aviso NO entra al pool como remoto y el texto de la ubicación no lo cambia: `isPoolRemoteCandidate`
 *   devuelve `true` cuando no hay ubicación, y aquí no se le pasa ninguna.
 */

/** El link del aviso tiene que quedar en `workable.com`: un widget hostil no puede mandar el «postular» a otro sitio. */
function workableUrl(value: unknown): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "workable.com" || host.endsWith(".workable.com") ? url : null;
  } catch {
    return null;
  }
}

function locationText(l: unknown): string {
  if (!l || typeof l !== "object") return "";
  const o = l as Record<string, unknown>;
  if (o.hidden === true) return "";
  return [text(o.city), text(o.region), text(o.country)].filter(Boolean).join(", ");
}

export function mapWorkableJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const url =
    workableUrl(item.url) ?? workableUrl(item.shortlink) ?? workableUrl(item.application_url);
  const title = atsHtmlToText(text(item.title));
  const id = text(item.shortcode) || text(item.id);
  if (!id || id.length > 100 || !url || !title) return "skip";

  const listed = (Array.isArray(item.locations) ? (item.locations as unknown[]) : [])
    .map(locationText)
    .filter(Boolean);
  const own = [text(item.city), text(item.state), text(item.country)].filter(Boolean).join(", ");
  const places = listed.length > 0 ? listed : own ? [own] : [];
  const location = joinAtsLocations(places[0] ?? "", places.slice(1));

  // Solo lo declarado cuenta como remoto: sin `telecommuting` booleano queda en false.
  const declaredRemote = item.telecommuting === true;

  const raw: RawJob = buildAtsRawJob({
    provider: "workable",
    token: board.token,
    id,
    sourceName: "Workable",
    url,
    title,
    companyName: board.companyName,
    locationRaw: location,
    // Sin texto de ubicación: la palabra «remoto» en la ciudad no puede volver remoto lo que la API no declara
    modality: modalityOfWorkplace(declaredRemote ? "remote" : null, declaredRemote, null),
    contractType: text(item.employment_type) || null,
    jdText: atsHtmlToText(text(item.description)) || null,
    postedAt: toDate(item.published_on) ?? toDate(item.created_at),
    categories: [text(item.department)].filter(Boolean),
    // El widget no trae salario.
    salary: atsSalary({ sourceName: "Workable" }),
    original: item,
  });
  // Lo que el widget no dice sobre países queda null (el prefiltro marca el riesgo de ubicación)
  raw.countriesAllowed = null;
  return {
    raw,
    // `locationText: null` a propósito: con ubicación vacía e `isRemote: false` el filtro descarta
    remote: { locationText: null, workplaceType: null, isRemote: declaredRemote },
  };
}

export type FetchWorkableOptions = AtsBoardOptions;

export async function fetchWorkableBoard(options: FetchWorkableOptions): Promise<AtsBoardResult> {
  return fetchAtsBoard("workable", options, {
    items: (body) => {
      const jobs = (body as { jobs?: unknown } | null)?.jobs;
      return Array.isArray(jobs) ? jobs : null;
    },
    map: (item) => mapWorkableJob(item, options),
  });
}
