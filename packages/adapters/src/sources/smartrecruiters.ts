import { isPoolRemoteCandidate, type RawJob } from "@job-search-os/pipeline";
import {
  AtsBoardError,
  atsBoardUrl,
  atsGetJson,
  atsHtmlToText,
  atsSalary,
  buildAtsRawJob,
  emptyBoardResult,
  httpUrl,
  joinAtsLocations,
  modalityOfWorkplace,
  SMARTRECRUITERS_PAGE_LIMIT,
  text,
  toDate,
  type AtsBoardOptions,
  type AtsBoardResult,
} from "./ats-common";

/**
 * SmartRecruiters, Posting API pública de cada empresa (R28-05, ADR-046). FORMATO A VERIFICAR con
 * `pool:fetch smartrecruiters <empresa> --dry-run` (no se grabó una respuesta real). Lo que se asume:
 * - Lista: `GET https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=100&offset=N`, sin
 *   clave, solo los avisos que la empresa hizo públicos. Respuesta `{ offset, limit, totalFound, content }`.
 *   Cada aviso de la lista: `id`, `name`, `releasedDate`, `location` (`city`, `region`, `country`,
 *   `remote`, `fullLocation`), `department.label`, `function.label`, `typeOfEmployment.label`.
 *   La lista NO trae descripción ni link: eso viene del detalle.
 * - Detalle: `GET .../postings/<id>`, con `postingUrl` y `jobAd.sections.<seccion>.text` (HTML).
 * - TOPES DE PEDIDOS por board y por corrida: `SMARTRECRUITERS_MAX_PAGES` páginas de la lista y
 *   `SMARTRECRUITERS_MAX_DETAILS` detalles. Solo se pide el detalle de los avisos que declaran remoto
 *   (`location.remote === true`), los más recientes primero; el resto de los remotos cuenta en `truncated`.
 * - SIN DESCRIPCIÓN NO SE INGESTA: un aviso cuyo detalle no trae texto (o no trae un `postingUrl` de
 *   smartrecruiters.com) se saltea. No hay un estado de «pendiente de JD» en el pool.
 * - FALLA CERRADO: una página de la lista con forma inesperada, o un detalle que falla por algo distinto de
 *   404 (timeout, 429, 5xx, 401/403), corta el board entero y no se devuelve ningún aviso parcial.
 *   Un detalle 404 saltea solo ese aviso. `countriesAllowed` es siempre `null`.
 */
export const SMARTRECRUITERS_MAX_PAGES = 3;
export const SMARTRECRUITERS_MAX_DETAILS = 25;

const POSTING_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const MAX_SECTION_CHARS = 100_000;

/** El link del aviso tiene que quedar en `smartrecruiters.com`. */
function smartRecruitersUrl(value: unknown): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "smartrecruiters.com" || host.endsWith(".smartrecruiters.com") ? url : null;
  } catch {
    return null;
  }
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const label = (value: unknown): string => text(obj(value).label);

type ListedPosting = {
  id: string;
  name: string;
  releasedAt: Date | null;
  item: Record<string, unknown>;
};

function locationOf(location: Record<string, unknown>): string | null {
  const place =
    text(location.fullLocation) ||
    [text(location.city), text(location.region), text(location.country).toUpperCase()]
      .filter(Boolean)
      .join(", ");
  return joinAtsLocations(place, []);
}

/** Texto de las secciones del aviso (HTML), en el orden de la API, con tope por sección. */
function jobAdText(detail: Record<string, unknown>): string {
  const sections = obj(obj(detail.jobAd).sections);
  const parts: string[] = [];
  for (const key of [
    "companyDescription",
    "jobDescription",
    "qualifications",
    "additionalInformation",
  ]) {
    const body = text(obj(sections[key]).text).slice(0, MAX_SECTION_CHARS);
    if (body) parts.push(atsHtmlToText(body));
  }
  return parts.filter(Boolean).join("\n\n");
}

export async function fetchSmartRecruitersBoard(options: AtsBoardOptions): Promise<AtsBoardResult> {
  // Valida token y región antes de cualquier pedido
  const listUrl = atsBoardUrl("smartrecruiters", options.token, options.region);
  const detailBase = listUrl.replace(/\/postings\?.*$/, "/postings/");

  // 1. Lista paginada, con tope de páginas
  const content: unknown[] = [];
  for (let page = 0; page < SMARTRECRUITERS_MAX_PAGES; page++) {
    const offset = page * SMARTRECRUITERS_PAGE_LIMIT;
    let body: unknown;
    try {
      body = await atsGetJson(`${listUrl}&offset=${offset}`, options);
    } catch (e) {
      if (e instanceof AtsBoardError && e.status === "not_found" && page === 0) {
        return emptyBoardResult("not_found");
      }
      throw e;
    }
    const pageItems = obj(body).content;
    if (!Array.isArray(pageItems)) throw new AtsBoardError("parse", "respuesta inesperada");
    content.push(...pageItems);
    const total = obj(body).totalFound;
    const reachedEnd =
      pageItems.length < SMARTRECRUITERS_PAGE_LIMIT ||
      (typeof total === "number" && offset + pageItems.length >= total);
    if (reachedEnd) break;
  }

  const result = emptyBoardResult("ok");
  result.seen = content.length;

  // 2. Embudo de la lista: estructura → remoto declarado
  const remote: ListedPosting[] = [];
  const seenIds = new Set<string>();
  for (const entry of content) {
    const item = obj(entry);
    const id = text(item.id);
    const name = atsHtmlToText(text(item.name));
    if (!POSTING_ID_RE.test(id) || !name) {
      result.skipped++;
      continue;
    }
    const declaredRemote = obj(item.location).remote === true;
    if (
      !isPoolRemoteCandidate({ locationText: null, workplaceType: null, isRemote: declaredRemote })
    ) {
      result.filteredNonRemote++;
      continue;
    }
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    remote.push({ id, name, releasedAt: toDate(item.releasedDate), item });
  }

  // 3. Los más recientes primero (sin fecha al final) y tope de detalles
  const time = (p: ListedPosting) => p.releasedAt?.getTime() ?? -Infinity;
  remote.sort((a, b) => (time(a) === time(b) ? 0 : time(a) < time(b) ? 1 : -1));
  const chosen = remote.slice(0, SMARTRECRUITERS_MAX_DETAILS);
  result.truncated = remote.length - chosen.length;

  // 4. Detalle de cada aviso elegido. Cualquier fallo que no sea 404 corta el board: nada parcial.
  const jobs: RawJob[] = [];
  for (const p of chosen) {
    let detail: Record<string, unknown>;
    try {
      detail = obj(await atsGetJson(`${detailBase}${encodeURIComponent(p.id)}`, options));
    } catch (e) {
      if (e instanceof AtsBoardError && e.status === "not_found") {
        result.skipped++;
        continue;
      }
      throw e;
    }
    const url = smartRecruitersUrl(detail.postingUrl);
    const jd = jobAdText(detail);
    if (!url || !jd) {
      result.skipped++;
      continue;
    }
    const location = obj(detail.location ?? p.item.location);
    const raw: RawJob = buildAtsRawJob({
      provider: "smartrecruiters",
      token: options.token,
      id: p.id,
      sourceName: "SmartRecruiters",
      url,
      title: atsHtmlToText(text(detail.name)) || p.name,
      companyName: options.companyName,
      locationRaw: locationOf(location),
      modality: modalityOfWorkplace("remote", true, null),
      contractType: label(detail.typeOfEmployment) || label(p.item.typeOfEmployment) || null,
      jdText: jd,
      postedAt: toDate(detail.releasedDate) ?? p.releasedAt,
      categories: [label(p.item.department), label(p.item.function)].filter(Boolean),
      salary: atsSalary({ sourceName: "SmartRecruiters" }),
      original: { list: p.item, detail },
    });
    raw.countriesAllowed = null;
    jobs.push(raw);
  }
  result.jobs = jobs;
  return result;
}
