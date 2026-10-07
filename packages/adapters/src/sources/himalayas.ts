import type { RawJob } from "@job-search-os/pipeline";
import { COUNTRY_TO_ISO, countryToIso, htmlToText } from "./getonboard";

/**
 * Himalayas, API pública de avisos remotos. FORMATO SIN VERIFICAR: se armó desde la documentación
 * conocida, sin llamada real (ronda 07, sin red). Todo lo marcado "a verificar" hay que contrastarlo
 * con una respuesta real antes de conectar al cron. Ver docs/sources/himalayas.md.
 * - `GET /jobs/api?limit=N&offset=M` → `{ jobs, totalCount, offset, limit }`, más nuevos primero
 *   (orden a verificar). Tope de `limit` por página: a verificar.
 * - `pubDate` en epoch de segundos (a verificar: podría venir en ms o ISO).
 * - `minSalary`/`maxSalary`: período a verificar. Hasta verificarlo no se llenan los campos de
 *   salario del RawJob: moneda y montos van solo en `salaryNote`.
 */
export const HIMALAYAS_BASE_URL = "https://himalayas.app/jobs/api";

export type HimalayasJobItem = {
  title?: string | null;
  excerpt?: string | null;
  companyName?: string | null;
  companySlug?: string | null;
  employmentType?: string | null;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  seniority?: string[] | null;
  locationRestrictions?: string[] | null;
  timezoneRestrictions?: (string | number)[] | null;
  categories?: string[] | null;
  parentCategories?: string[] | null;
  description?: string | null;
  pubDate?: number | null;
  expiryDate?: number | null;
  applicationLink?: string | null;
  guid?: string | null;
};

export type HimalayasPage = {
  jobs?: HimalayasJobItem[];
  totalCount?: number;
  offset?: number;
  limit?: number;
};

const WORLDWIDE = /^(worldwide|anywhere|global|world ?wide)$/i;

function isIso2(s: string): boolean {
  return /^[A-Za-z]{2}$/.test(s);
}

/**
 * Restricciones de la fuente → ISO. Vacío no es "cualquier país": queda null para que el
 * prefiltro marque el riesgo. Un nombre que no se puede mapear deja todo en null (no se
 * restringe a un subconjunto parcial).
 */
function locationOf(restrictions: string[]): {
  locationRaw: string;
  countriesAllowed: string[] | null;
} {
  const names = restrictions.map((r) => r.trim()).filter(Boolean);
  if (names.length === 0) {
    return { locationRaw: "Remoto (sin restricción de país indicada)", countriesAllowed: null };
  }
  const locationRaw = `Remoto (${names.join(", ")})`;
  if (names.some((n) => WORLDWIDE.test(n))) return { locationRaw, countriesAllowed: ["*"] };
  const known = names.every(
    (n) =>
      isIso2(n) ||
      n.toLowerCase() in COUNTRY_TO_ISO ||
      n.toLowerCase().replace(/\s+/g, "-") in COUNTRY_TO_ISO,
  );
  return {
    locationRaw,
    countriesAllowed: known
      ? names.map((n) => (isIso2(n) ? n.toUpperCase() : countryToIso(n)))
      : null,
  };
}

function toDate(epochSeconds: number | null | undefined): Date | null {
  return typeof epochSeconds === "number" && Number.isFinite(epochSeconds) && epochSeconds > 0
    ? new Date(epochSeconds * 1000)
    : null;
}

/**
 * Un item de la API → RawJob. Puro. Falla cerrado: sin `guid` o `title` devuelve null
 * (no se inventan campos).
 */
export function mapHimalayasJob(item: HimalayasJobItem): RawJob | null {
  const guid = item.guid?.trim();
  const title = item.title?.trim();
  if (!guid || !title) return null;

  const { locationRaw, countriesAllowed } = locationOf(item.locationRestrictions ?? []);
  const min = item.minSalary || null;
  const max = item.maxSalary || null;
  const hasSalary = min !== null || max !== null;
  const currency = item.currency?.trim().toUpperCase() ?? null;

  // El período no está verificado: los montos van solo en la nota, nunca en los campos que usa decide()
  const salaryNote = hasSalary
    ? `${currency ?? "moneda no indicada"} ${min ?? "?"}–${max ?? "?"}, período a verificar`
    : null;

  const jd = htmlToText(item.description);
  const seniority = (item.seniority ?? []).filter(Boolean);
  return {
    source: {
      kind: "other",
      name: "Himalayas",
      externalId: `himalayas:${guid}`,
      url: item.applicationLink ?? null,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title,
    companyRaw: item.companyName?.trim() || "desconocida",
    locationRaw,
    countriesAllowed,
    modality: "remoto",
    contractType: item.employmentType ?? null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: jd || null,
    postedAt: toDate(item.pubDate),
    tags: [...(item.categories ?? [])],
    seniority: seniority.length ? seniority.join(", ") : null,
    lang: null,
  };
}

export type FetchHimalayasOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente). */
  since: Date;
  limit?: number;
  /** Tope de páginas, para acotar llamadas. */
  maxPages?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchHimalayasResult = {
  jobs: RawJob[];
  pagesFetched: number;
  /** Avisos vistos antes de filtrar por fecha. */
  seen: number;
  /** Avisos sin guid o título, descartados. */
  skipped: number;
};

export function himalayasUrl(baseUrl: string, limit: number, offset: number): string {
  return `${baseUrl}?limit=${limit}&offset=${offset}`;
}

/**
 * Pagina por offset (más nuevos primero), se queda con los publicados desde `since` y corta
 * cuando una página entera es más vieja, cuando se acaban los avisos o con `maxPages`.
 */
export async function fetchHimalayasJobs(
  options: FetchHimalayasOptions,
): Promise<FetchHimalayasResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? HIMALAYAS_BASE_URL;
  const limit = options.limit ?? 20;
  const maxPages = options.maxPages ?? 10;
  const sinceMs = options.since.getTime();

  const byId = new Map<string, RawJob>();
  let pagesFetched = 0;
  let seen = 0;
  let skipped = 0;
  let offset = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(himalayasUrl(baseUrl, limit, offset), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Himalayas offset ${offset}: HTTP ${res.status}`);
    const body = (await res.json()) as HimalayasPage;
    pagesFetched++;
    const items = body.jobs ?? [];
    seen += items.length;
    let olderThanWindow = 0;
    for (const item of items) {
      const posted = toDate(item.pubDate);
      if (posted && posted.getTime() < sinceMs) {
        olderThanWindow++;
        continue;
      }
      const raw = mapHimalayasJob(item);
      if (!raw) {
        skipped++;
        continue;
      }
      if (!byId.has(raw.source.externalId!)) byId.set(raw.source.externalId!, raw);
    }
    offset += items.length;
    const total = body.totalCount ?? Infinity;
    if (items.length === 0 || offset >= total || olderThanWindow === items.length) break;
  }
  return { jobs: [...byId.values()], pagesFetched, seen, skipped };
}
