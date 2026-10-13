import type { RawJob } from "@job-search-os/pipeline";
import {
  atsHtmlToText,
  atsSalary,
  buildAtsRawJob,
  fetchAtsBoard,
  httpUrl,
  modalityOfWorkplace,
  text,
  toDate,
  type AtsBoardOptions,
  type AtsBoardResult,
  type AtsMapped,
} from "./ats-common";

/**
 * Greenhouse Job Board API (pública, sin credenciales). FORMATO A VERIFICAR con `--dry-run`: sale
 * de su documentación pública (https://developers.greenhouse.io/job-board.html), sin llamada real.
 * - `GET https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` → `{ jobs: [...] }`.
 * - `content` viene con las etiquetas HTML escapadas (`&lt;p&gt;`): se decodifica y se pasa a texto.
 * - La API pública no trae sueldo ni modalidad: la modalidad solo se infiere de la ubicación.
 * Ver docs/sources/greenhouse.md.
 */
export function mapGreenhouseJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const id = item.id != null && String(item.id).trim() ? String(item.id).trim() : null;
  const url = httpUrl(item.absolute_url);
  const title = atsHtmlToText(text(item.title));
  if (!id || !url || !title) return "skip";

  const loc = item.location as { name?: unknown } | null | undefined;
  const location = text(loc?.name) || null;
  const departments = Array.isArray(item.departments)
    ? (item.departments as { name?: unknown }[]).map((d) => text(d?.name)).filter(Boolean)
    : [];

  const raw: RawJob = buildAtsRawJob({
    provider: "greenhouse",
    token: board.token,
    id,
    sourceName: "Greenhouse",
    url,
    title,
    companyName: board.companyName,
    locationRaw: location,
    modality: modalityOfWorkplace(null, null, location),
    jdText: atsHtmlToText(typeof item.content === "string" ? item.content : null),
    postedAt: toDate(item.first_published) ?? toDate(item.updated_at),
    categories: departments,
    salary: atsSalary({ sourceName: "Greenhouse" }),
    original: item,
  });
  return { raw, remote: { locationText: location, workplaceType: null, isRemote: null } };
}

export type FetchGreenhouseOptions = AtsBoardOptions;

export async function fetchGreenhouseBoard(
  options: FetchGreenhouseOptions,
): Promise<AtsBoardResult> {
  return fetchAtsBoard("greenhouse", options, {
    items: (body) => {
      const jobs = (body as { jobs?: unknown } | null)?.jobs;
      return Array.isArray(jobs) ? jobs : null;
    },
    map: (item) => mapGreenhouseJob(item, options),
  });
}
