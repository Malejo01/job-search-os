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
 * Lever Postings API (pública, sin credenciales). FORMATO A VERIFICAR con `--dry-run`: sale de su
 * documentación pública (https://github.com/lever/postings-api), sin llamada real.
 * - `GET https://api.lever.co/v0/postings/{token}?mode=json` → array de avisos
 *   (`api.eu.lever.co` si el board es de la región `eu`).
 * - `workplaceType`: remote | hybrid | on-site | unspecified. `createdAt` en ms.
 * - `descriptionPlain` + `lists[]` (título + HTML) + `additionalPlain` forman el texto.
 * Ver docs/sources/lever.md.
 */
function jdTextOf(item: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const desc = text(item.descriptionPlain) || atsHtmlToText(text(item.description));
  if (desc) parts.push(desc);
  if (Array.isArray(item.lists)) {
    for (const l of item.lists as { text?: unknown; content?: unknown }[]) {
      const heading = atsHtmlToText(text(l?.text));
      const body = atsHtmlToText(text(l?.content));
      if (heading || body) parts.push([heading, body].filter(Boolean).join("\n"));
    }
  }
  const extra = text(item.additionalPlain) || atsHtmlToText(text(item.additional));
  if (extra) parts.push(extra);
  return parts.join("\n\n") || null;
}

export function mapLeverJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  const id = text(item.id);
  const url = httpUrl(item.hostedUrl);
  const title = atsHtmlToText(text(item.text));
  if (!id || !url || !title) return "skip";

  const cats = (item.categories ?? {}) as Record<string, unknown>;
  const location = text(cats.location) || null;
  const workplaceType = text(item.workplaceType) || null;
  const range = (item.salaryRange ?? null) as Record<string, unknown> | null;
  const team = text(cats.team);
  const commitment = text(cats.commitment);

  const raw: RawJob = buildAtsRawJob({
    provider: "lever",
    token: board.token,
    id,
    sourceName: "Lever",
    url,
    title,
    companyName: board.companyName,
    locationRaw: location,
    modality: modalityOfWorkplace(workplaceType, null, location),
    contractType: commitment || null,
    jdText: jdTextOf(item),
    postedAt: toDate(item.createdAt),
    categories: team ? [team] : [],
    salary: range
      ? atsSalary({
          min: range.min,
          max: range.max,
          currency: range.currency,
          interval: range.interval,
          sourceName: "Lever",
        })
      : atsSalary({ sourceName: "Lever" }),
    original: item,
  });
  return { raw, remote: { locationText: location, workplaceType, isRemote: null } };
}

export type FetchLeverOptions = AtsBoardOptions;

export async function fetchLeverBoard(options: FetchLeverOptions): Promise<AtsBoardResult> {
  return fetchAtsBoard("lever", options, {
    items: (body) => (Array.isArray(body) ? body : null),
    map: (item) => mapLeverJob(item, options),
  });
}
