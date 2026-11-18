import type { RawJob } from "@job-search-os/pipeline";
import {
  atsBoardUrl,
  atsHtmlToText,
  atsSalary,
  atsStatusOf,
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
import { tagText } from "./wwr";

/**
 * Teamtailor, feed público de cada sitio de empleos. R16-3: se pide primero el JSON Feed (`jobs.json`) y,
 * si falla (404, forma inesperada, no es JSON, otro 4xx) o no trae avisos, el RSS de siempre (`jobs.rss`);
 * ver `fetchTeamtailorBoard`. Los avisos siguen saliendo del RSS: el parser del JSON Feed (campos estándar,
 * `mapTeamtailorJsonItem`) queda listo pero filtrado hasta verificar su modalidad con un board real.
 * Formato RSS verificado por mercado el 21/10
 * (ver docs/sources/teamtailor.md); se confirma con `pool:fetch teamtailor <token> --dry-run`.
 * - `GET https://<token>.teamtailor.com/jobs.rss` (`<token>.na.teamtailor.com` si la región es `na`).
 *   Sin paginación ni HTML (condiciones en docs/sources/teamtailor.md).
 * - Cada `<item>`: `title`, `description` (HTML con entidades escapadas), `pubDate` (RFC 822),
 *   `link` (`https://<host>/jobs/<id>-<slug>`), `guid`, `remoteStatus` (fully | hybrid | onsite |
 *   none, sin namespace), `tt:locations` (0 a N `tt:location` con name/city/country),
 *   `tt:department`, `tt:role` y `tt:division`.
 * - Falla cerrado por item: sin id, title o link http(s) válido se saltea. Lo que el feed no dice
 *   queda `null` (ubicación, países, salario); `remoteStatus=none` NO es remoto.
 */
export type TeamtailorLocation = {
  name: string | null;
  city: string | null;
  country: string | null;
};

export type TeamtailorItem = {
  guid: string | null;
  title: string | null;
  link: string | null;
  description: string | null;
  pubDate: string | null;
  remoteStatus: string | null;
  locations: TeamtailorLocation[];
  department: string | null;
  role: string | null;
  division: string | null;
};

const MAX_LOCATIONS_PER_ITEM = 50;
/**
 * Tope por `<item>` (revisión de seguridad, ronda 120): las regex de `tagText` son lazy, y con
 * aperturas sin cierre en un item enorme el costo crece al cuadrado. Un aviso real pesa pocos KB.
 */
export const MAX_ITEM_CHARS = 200_000;
const MAX_GUID_CHARS = 200;

/**
 * Contenido de cada `<item>…</item>`, cortado con `indexOf` (lineal) en vez de una regex lazy sobre
 * el feed entero. Un `<item>` sin cierre termina la lectura; uno más largo que el tope se saltea.
 */
function itemChunks(xml: string): string[] {
  const out: string[] = [];
  const lower = xml.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<item", from);
    if (open === -1) break;
    const next = lower[open + 5];
    if (next !== ">" && next !== " " && next !== "\t" && next !== "\n" && next !== "\r") {
      from = open + 5;
      continue;
    }
    const start = lower.indexOf(">", open);
    if (start === -1) break;
    const end = lower.indexOf("</item>", start);
    if (end === -1) break;
    if (end - start <= MAX_ITEM_CHARS) out.push(xml.slice(start + 1, end));
    from = end + 7;
  }
  return out;
}

/** Todos los `<item>` del feed, sin validar (la validación por item la hace `mapTeamtailorJob`). */
export function parseTeamtailorFeed(xml: string): TeamtailorItem[] {
  const items: TeamtailorItem[] = [];
  for (const chunk of itemChunks(xml)) {
    const locations: TeamtailorLocation[] = [];
    const block = /<tt:locations(?:\s[^>]*)?>([\s\S]*?)<\/tt:locations>/i.exec(chunk)?.[1] ?? "";
    for (const l of block.matchAll(/<tt:location(?:\s[^>]*)?>([\s\S]*?)<\/tt:location>/gi)) {
      if (locations.length >= MAX_LOCATIONS_PER_ITEM) break;
      locations.push({
        name: tagText(l[1]!, "tt:name"),
        city: tagText(l[1]!, "tt:city"),
        country: tagText(l[1]!, "tt:country"),
      });
    }
    // Los datos de las ubicaciones no se confunden con los del item: se leen sin ese bloque.
    const rest = block ? chunk.replace(block, "") : chunk;
    items.push({
      guid: tagText(rest, "guid"),
      title: tagText(rest, "title"),
      link: tagText(rest, "link"),
      description: tagText(rest, "description"),
      pubDate: tagText(rest, "pubDate"),
      remoteStatus: tagText(rest, "remoteStatus"),
      locations,
      department: tagText(rest, "tt:department"),
      role: tagText(rest, "tt:role"),
      division: tagText(rest, "tt:division"),
    });
  }
  return items;
}

/** `fully` | `hybrid` | `onsite` → el modo para el filtro de remotos; `none` o ausente → null. */
function workplaceOf(remoteStatus: string | null): string | null {
  switch ((remoteStatus ?? "").trim().toLowerCase()) {
    case "fully":
      return "remote";
    case "hybrid":
      return "hybrid";
    case "onsite":
      return "onsite";
    default:
      return null;
  }
}

function locationOf(l: TeamtailorLocation): string {
  const place = [l.city, l.country].filter(Boolean).join(", ");
  return place || l.name || "";
}

/** Número inicial del path `/jobs/<id>-<slug>` del link. */
function idFromLink(link: string): string {
  try {
    return /^\/jobs\/(\d+)(?:-|$)/.exec(new URL(link).pathname)?.[1] ?? "";
  } catch {
    return "";
  }
}

/**
 * El link del aviso tiene que quedar en `teamtailor.com` (revisión de seguridad, ronda 120): un feed
 * hostil no puede mandar el «postular» a otro sitio. Un board con dominio propio sale todo salteado
 * en el `--dry-run`, y ahí se decide.
 */
function teamtailorUrl(value: unknown): string | null {
  const url = httpUrl(value);
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "teamtailor.com" || host.endsWith(".teamtailor.com") ? url : null;
  } catch {
    return null;
  }
}

export function mapTeamtailorJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const url = teamtailorUrl(item.link);
  const title = atsHtmlToText(text(item.title));
  const guid = text(item.guid);
  if (guid.length > MAX_GUID_CHARS) return "skip";
  const id = guid || (url ? idFromLink(url) : "");
  if (!id || !url || !title) return "skip";

  const locs = (Array.isArray(item.locations) ? (item.locations as TeamtailorLocation[]) : [])
    .map((l) => locationOf(l ?? { name: null, city: null, country: null }))
    .filter(Boolean);
  const location = joinAtsLocations(locs[0] ?? "", locs.slice(1));
  const workplaceType = workplaceOf(text(item.remoteStatus) || null);

  const raw: RawJob = buildAtsRawJob({
    provider: "teamtailor",
    token: board.token,
    id,
    sourceName: "Teamtailor",
    url,
    title,
    companyName: board.companyName,
    locationRaw: location,
    modality: modalityOfWorkplace(workplaceType, null, location),
    jdText: atsHtmlToText(text(item.description)) || null,
    postedAt: toDate(item.pubDate),
    categories: [text(item.department), text(item.role)].filter(Boolean),
    // El feed no trae salario.
    salary: atsSalary({ sourceName: "Teamtailor" }),
    original: item,
  });
  return { raw, remote: { locationText: location, workplaceType, isRemote: null } };
}

/** JSON Feed 1.0 o 1.1: `version` es la URL de la especificación. */
const JSON_FEED_VERSION = /^https:\/\/jsonfeed\.org\/version\/1(?:\.\d+)?\/?$/;
const MAX_JSON_TAGS = 20;
const MAX_TAG_CHARS = 100;

/**
 * Ítems de un JSON Feed. Falla cerrado: si el cuerpo no es un objeto con `version` de JSON Feed 1.x e
 * `items` como lista, devuelve null y el feed entero se descarta (el llamador cae al RSS).
 */
export function jsonFeedItems(body: unknown): unknown[] | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const feed = body as { version?: unknown; items?: unknown };
  if (typeof feed.version !== "string" || !JSON_FEED_VERSION.test(feed.version)) return null;
  return Array.isArray(feed.items) ? feed.items : null;
}

/**
 * Un ítem de JSON Feed (`jobs.json`) → aviso (listo para cuando se verifique la modalidad; hoy el filtro de
 * remotos lo descarta, ver el final de la función). Solo campos ESTÁNDAR de JSON Feed 1.1: `id`, `url`,
 * `title`, `content_html` o `content_text` (o `summary`), `date_published` y `tags`. Los campos propios de
 * Teamtailor (ubicación, remoto, departamento) no se leen: no están verificados contra un board real,
 * así que la ubicación y los países quedan `null` y la modalidad `desconocida` (nunca remoto por
 * omisión). Mismas reglas por ítem que el RSS: sin id, título o link de teamtailor.com se saltea.
 */
export function mapTeamtailorJsonItem(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const url = teamtailorUrl(item.url);
  const title = atsHtmlToText(text(item.title));
  const rawId = text(item.id);
  if (rawId.length > MAX_GUID_CHARS) return "skip";
  const id = rawId || (url ? idFromLink(url) : "");
  if (!id || !url || !title) return "skip";

  const tags = (Array.isArray(item.tags) ? item.tags : [])
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().slice(0, MAX_TAG_CHARS))
    .filter(Boolean)
    .slice(0, MAX_JSON_TAGS);
  const body = text(item.content_html) || text(item.content_text) || text(item.summary);

  const raw: RawJob = buildAtsRawJob({
    provider: "teamtailor",
    token: board.token,
    id,
    sourceName: "Teamtailor",
    url,
    title,
    companyName: board.companyName,
    locationRaw: null,
    modality: modalityOfWorkplace(null, null, null),
    jdText: atsHtmlToText(body) || null,
    postedAt: toDate(item.date_published),
    categories: tags,
    salary: atsSalary({ sourceName: "Teamtailor" }),
    original: item,
  });
  // FALLA CERRADO: el JSON Feed estándar no dice si el puesto es remoto ni dónde queda, y sin ese dato
  // `isPoolRemoteCandidate` deja pasar todo (ubicación vacía = «ante la duda se guarda»), con lo que entrarían
  // al pool también los avisos presenciales. Hasta verificar los campos de modalidad con un board real
  // (`pool:fetch teamtailor <token> --dry-run`), un aviso del JSON Feed no cuenta como remoto:
  // `isRemote: false` sin ubicación lo filtra. Cuando se mapee la modalidad, esto se reemplaza por el dato real.
  return { raw, remote: { locationText: null, workplaceType: null, isRemote: false } };
}

export type FetchTeamtailorOptions = AtsBoardOptions;

/**
 * Se cae al RSS si el JSON Feed no existe (404), no tiene la forma esperada o no es JSON (`parse`), o
 * responde otro 4xx. Los fallos transitorios (timeout, 429, 5xx, tamaño) no se reintentan por el otro
 * camino: el RSS vive en el mismo host y no ayudaría, y duplicaría la carga sobre un sitio caído.
 */
function fallsBackToRss(e: unknown): boolean {
  const status = atsStatusOf(e);
  return status === "parse" || status === "http_4xx";
}

/**
 * Un board de Teamtailor: primero `jobs.json` (JSON Feed 1.1) y, si falla como arriba o no trae avisos,
 * `jobs.rss`. HOY los avisos salen del RSS: el JSON Feed no trae avisos remotos mientras su modalidad no
 * esté verificada (`mapTeamtailorJsonItem`). Si fallan los dos, el board queda con el estado cerrado del RSS
 * (`not_found` o el código del error). Mismo embudo y misma firma que antes; nunca más de dos GET por board.
 */
export async function fetchTeamtailorBoard(
  options: FetchTeamtailorOptions,
): Promise<AtsBoardResult> {
  // Valida token y región antes de cualquier request (`invalid_token` sale de acá)
  const rssUrl = atsBoardUrl("teamtailor", options.token, options.region);
  const jsonUrl = rssUrl.replace(/\/jobs\.rss$/, "/jobs.json");
  try {
    const result = await fetchAtsBoard("teamtailor", options, {
      url: jsonUrl,
      items: jsonFeedItems,
      map: (item) => mapTeamtailorJsonItem(item, options),
    });
    // Hoy el JSON Feed no aporta avisos (ver `mapTeamtailorJsonItem`): solo se usa si trajo alguno; si no,
    // los avisos salen del RSS, que sí trae modalidad y ubicación.
    if (result.status !== "not_found" && result.jobs.length > 0) return result;
  } catch (e) {
    if (!fallsBackToRss(e)) throw e;
  }
  return fetchAtsBoard("teamtailor", options, {
    format: "text",
    url: rssUrl,
    items: (body) => {
      if (typeof body !== "string" || !/<rss[\s>]/i.test(body)) return null;
      return parseTeamtailorFeed(body);
    },
    map: (item) => mapTeamtailorJob(item, options),
  });
}
