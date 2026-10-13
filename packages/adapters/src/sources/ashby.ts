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
  type AtsSalaryFields,
} from "./ats-common";

/**
 * Ashby Job Postings API (pública, sin credenciales). FORMATO A VERIFICAR con `--dry-run`: sale de
 * su documentación pública (https://developers.ashbyhq.com/docs/public-job-posting-api).
 * - `GET https://api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` → `{ jobs: [...] }`.
 * - `isListed === false` se descarta. `workplaceType`: Remote | Hybrid | OnSite. `isRemote` boolean.
 * - `compensation.summaryComponents[]` con `compensationType: "Salary"`, `interval` ("1 YEAR"),
 *   `currencyCode`, `minValue` y `maxValue`.
 * Ver docs/sources/ashby.md.
 */
function salaryOf(compensation: unknown): AtsSalaryFields {
  const empty = atsSalary({ sourceName: "Ashby" });
  const comp = compensation as { summaryComponents?: unknown; compensationTierSummary?: unknown };
  if (!comp || typeof comp !== "object") return empty;
  const components = Array.isArray(comp.summaryComponents)
    ? (comp.summaryComponents as Record<string, unknown>[])
    : [];
  const salary = components.find((c) => c && text(c.compensationType).toLowerCase() === "salary");
  if (salary) {
    return atsSalary({
      min: salary.minValue,
      max: salary.maxValue,
      currency: salary.currencyCode,
      interval: salary.interval,
      sourceName: "Ashby",
    });
  }
  const summary = text(comp.compensationTierSummary);
  return summary ? { ...empty, salaryNote: `${summary.slice(0, 200)} según Ashby` } : empty;
}

export function mapAshbyJob(
  item: Record<string, unknown>,
  board: { token: string; companyName: string },
): AtsMapped {
  if (item.isListed === false) return "unlisted";
  const url = httpUrl(item.jobUrl);
  const title = atsHtmlToText(text(item.title));
  // Ashby no trae `id` en todas las versiones: se saca del final de la URL del aviso.
  const id =
    text(item.id) || (url ? (new URL(url).pathname.split("/").filter(Boolean).pop() ?? "") : "");
  if (!id || !url || !title) return "skip";

  const location = text(item.location) || null;
  const secondary = Array.isArray(item.secondaryLocations)
    ? (item.secondaryLocations as unknown[])
        .map((l) =>
          text(typeof l === "string" ? l : (l as { location?: unknown } | null)?.location),
        )
        .filter(Boolean)
    : [];
  const allLocations = [location, ...secondary].filter(Boolean).join("; ") || null;
  const workplaceType = text(item.workplaceType) || null;
  const isRemote = typeof item.isRemote === "boolean" ? item.isRemote : null;
  const department = text(item.department);
  const team = text(item.team);

  const raw: RawJob = buildAtsRawJob({
    provider: "ashby",
    token: board.token,
    id,
    sourceName: "Ashby",
    url,
    title,
    companyName: board.companyName,
    locationRaw: allLocations,
    modality: modalityOfWorkplace(workplaceType, isRemote, allLocations),
    contractType: text(item.employmentType) || null,
    jdText: text(item.descriptionPlain) || atsHtmlToText(text(item.descriptionHtml)) || null,
    postedAt: toDate(item.publishedAt),
    categories: [department, team].filter(Boolean),
    salary: salaryOf(item.compensation),
    original: item,
  });
  return { raw, remote: { locationText: allLocations, workplaceType, isRemote } };
}

export type FetchAshbyOptions = AtsBoardOptions;

export async function fetchAshbyBoard(options: FetchAshbyOptions): Promise<AtsBoardResult> {
  return fetchAtsBoard("ashby", options, {
    items: (body) => {
      const jobs = (body as { jobs?: unknown } | null)?.jobs;
      return Array.isArray(jobs) ? jobs : null;
    },
    map: (item) => mapAshbyJob(item, options),
  });
}
