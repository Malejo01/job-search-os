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
import { tagText } from "./wwr";

/**
 * Teamtailor, feed RSS público de cada sitio de empleos. Formato verificado por mercado el 21/10
 * (ver docs/sources/teamtailor.md); se confirma con `pool:fetch teamtailor <token> --dry-run`.
 * - `GET https://<token>.teamtailor.com/jobs.rss` (`<token>.na.teamtailor.com` si la región es `na`).
 *   Un único GET por board, sin paginación ni HTML (condiciones en docs/sources/teamtailor.md).
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

/** Todos los `<item>` del feed, sin validar (la validación por item la hace `mapTeamtailorJob`). */
export function parseTeamtailorFeed(xml: string): TeamtailorItem[] {
  const items: TeamtailorItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const chunk = m[1]!;
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

export function mapTeamtailorJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const url = httpUrl(item.link);
  const title = atsHtmlToText(text(item.title));
  const id = text(item.guid) || (url ? idFromLink(url) : "");
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

export type FetchTeamtailorOptions = AtsBoardOptions;

export async function fetchTeamtailorBoard(
  options: FetchTeamtailorOptions,
): Promise<AtsBoardResult> {
  return fetchAtsBoard("teamtailor", options, {
    format: "text",
    items: (body) => {
      if (typeof body !== "string" || !/<rss[\s>]/i.test(body)) return null;
      return parseTeamtailorFeed(body);
    },
    map: (item) => mapTeamtailorJob(item, options),
  });
}
