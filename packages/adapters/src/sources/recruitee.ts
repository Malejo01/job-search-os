import type { RawJob } from "@job-search-os/pipeline";
import {
  AtsBoardError,
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
 * Recruitee, Careers Site API de cada empresa (R28-05, ADR-046). FORMATO A VERIFICAR con
 * `pool:fetch recruitee <empresa> --dry-run` (no se grabó una respuesta real). Lo que se asume:
 * - `GET https://<empresa>.recruitee.com/api/offers/`, sin clave. Respuesta `{ offers: [...] }`.
 *   Cada aviso: `id`, `status`, `title`, `description` y `requirements` (HTML), `location`, `city`,
 *   `country`, `remote` / `hybrid` / `on_site` (booleanos), `department`, `employment_type_code`,
 *   `careers_url`, `published_at` / `created_at`, `tags`.
 * - DESDE EL 10/02/2027 la documentación oficial exige el header `X-Careers-Sites-Token` (un token que
 *   genera cada empresa). Este adaptador NO lo implementa: ante 401 o 403 falla cerrado con `http_4xx`,
 *   sin reintentos y sin avisos parciales. Después de esa fecha solo servirá con el token de la empresa.
 * - FALLA CERRADO por aviso: sin id, título o link http(s) en `recruitee.com` se saltea; un aviso con
 *   `status` distinto de `published` también. Una respuesta sin `offers` en forma de lista se descarta
 *   entera. Lo que la API no dice queda `null`; `countriesAllowed` es siempre `null`.
 * - REMOTO: solo cuenta lo que la API declara (`remote === true`). Sin ese dato el aviso NO entra como remoto
 *   y el texto de la ubicación no lo cambia.
 */

/** El link del aviso tiene que quedar en `recruitee.com`: una respuesta hostil no puede mandar el «postular» a otro sitio. */
function recruiteeUrl(value: unknown): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "recruitee.com" || host.endsWith(".recruitee.com") ? url : null;
  } catch {
    return null;
  }
}

/** Id como texto: acepta cadena o entero; nada más, y con tope de largo. */
function idText(value: unknown): string {
  if (typeof value === "number")
    return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
  return text(value);
}

const MAX_TAGS = 20;
const MAX_TAG_CHARS = 100;

export function mapRecruiteeOffer(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  if (typeof item.status === "string" && item.status !== "published") return "skip";
  const url = recruiteeUrl(item.careers_url) ?? recruiteeUrl(item.careers_apply_url);
  const title = atsHtmlToText(text(item.title));
  const id = idText(item.id) || text(item.guid);
  if (!id || id.length > 100 || !url || !title) return "skip";

  const own = [text(item.city), text(item.country)].filter(Boolean).join(", ");
  const location = joinAtsLocations(text(item.location) || own, []);

  // Solo lo declarado cuenta como remoto: sin `remote` booleano queda en false.
  const declaredRemote = item.remote === true;
  const workplace = declaredRemote
    ? "remote"
    : item.hybrid === true
      ? "hybrid"
      : item.on_site === true
        ? "onsite"
        : null;

  const tags = (Array.isArray(item.tags) ? item.tags : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, MAX_TAG_CHARS))
    .filter(Boolean)
    .slice(0, MAX_TAGS);
  const body = [text(item.description), text(item.requirements)].filter(Boolean).join("\n\n");

  const raw: RawJob = buildAtsRawJob({
    provider: "recruitee",
    token: board.token,
    id,
    sourceName: "Recruitee",
    url,
    title,
    companyName: board.companyName,
    locationRaw: location,
    // Sin texto de ubicación: la palabra «remoto» en la ciudad no puede volver remoto lo que la API no declara
    modality: modalityOfWorkplace(workplace, declaredRemote, null),
    contractType: text(item.employment_type_code) || null,
    jdText: atsHtmlToText(body) || null,
    postedAt: toDate(item.published_at) ?? toDate(item.created_at),
    categories: [text(item.department), ...tags].filter(Boolean),
    // No se lee salario: la API pública no lo declara de forma verificada.
    salary: atsSalary({ sourceName: "Recruitee" }),
    original: item,
  });
  // Lo que la API no dice sobre países queda null (el prefiltro marca el riesgo de ubicación)
  raw.countriesAllowed = null;
  return {
    raw,
    // `locationText: null` a propósito: con ubicación vacía e `isRemote: false` el filtro descarta
    remote: { locationText: null, workplaceType: null, isRemote: declaredRemote },
  };
}

export type FetchRecruiteeOptions = AtsBoardOptions;

export async function fetchRecruiteeBoard(options: FetchRecruiteeOptions): Promise<AtsBoardResult> {
  try {
    return await fetchAtsBoard("recruitee", options, {
      items: (body) => {
        const offers = (body as { offers?: unknown } | null)?.offers;
        return Array.isArray(offers) ? offers : null;
      },
      map: (item) => mapRecruiteeOffer(item, options),
    });
  } catch (e) {
    // 401/403: el sitio de empleos exige el token de la empresa (X-Careers-Sites-Token). Falla cerrado.
    if (e instanceof Error && /\bHTTP (401|403)\b/.test(e.message)) {
      throw new AtsBoardError("http_4xx", "requiere el token del sitio de empleos");
    }
    throw e;
  }
}
