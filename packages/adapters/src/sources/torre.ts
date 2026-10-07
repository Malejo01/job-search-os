import type { Modality, RawJob } from "@job-search-os/pipeline";
import { htmlToText } from "./getonboard";

/**
 * Torre. NO HAY API PÚBLICA DE AVISOS DOCUMENTADA: esto se arma sobre el buscador público que se
 * conoce, y TODO está a verificar (endpoint, body de filtros, forma del resultado, términos de
 * uso). Ronda 07, sin red. Ver docs/sources/torre.md.
 * - `POST /opportunities/_search/?size=N&offset=M` con filtros en el body →
 *   `{ results, total, size, offset }`. Orden de los resultados: a verificar.
 * - Por resultado: `id`, `objective` (título), `organizations[].name`, `locations[]`, `remote`,
 *   `compensation { minAmount, maxAmount, currency, periodicity }`, `skills[].name`,
 *   `created`/`deadline` (ISO), `type`.
 */
export const TORRE_BASE_URL = "https://search.torre.co/opportunities/_search/";
/** Body de filtros por defecto: solo remotos. A verificar. */
export const TORRE_DEFAULT_FILTERS = { and: [{ remote: { term: true } }] } as const;
/** URL pública del aviso a partir del id. A verificar. */
export const TORRE_JOB_URL = "https://torre.ai/post";

export type TorreResult = {
  id?: string | null;
  objective?: string | null;
  type?: string | null;
  organizations?: { name?: string | null }[] | null;
  locations?: string[] | null;
  remote?: boolean | null;
  compensation?: {
    minAmount?: number | null;
    maxAmount?: number | null;
    currency?: string | null;
    periodicity?: string | null;
  } | null;
  skills?: { name?: string | null }[] | null;
  created?: string | null;
  deadline?: string | null;
  /** No se sabe si el buscador lo devuelve; si viene, se usa como JD. */
  description?: string | null;
};

export type TorrePage = {
  results?: TorreResult[];
  total?: number;
  size?: number;
  offset?: number;
};

const WORLDWIDE = /^(worldwide|anywhere|global)$/i;
const HYBRID = /h[ií]brid|hybrid/i;
const ONSITE = /presencial|on-?site/i;

function periodOf(p: string | null | undefined): RawJob["salaryPeriod"] {
  switch (p?.trim().toLowerCase()) {
    case "monthly":
      return "mensual";
    case "yearly":
    case "annually":
      return "anual";
    case "hourly":
      return "hora";
    default:
      return null;
  }
}

function modalityOf(r: TorreResult): Modality {
  if (r.remote === true) return "remoto";
  // remote: false no dice presencial: solo con una indicación explícita
  const text = [r.type ?? "", ...(r.locations ?? [])].join(" ");
  if (HYBRID.test(text)) return "hibrido";
  if (ONSITE.test(text)) return "presencial";
  return "desconocida";
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Un resultado del buscador → RawJob. Puro. Falla cerrado: sin `id` u `objective` devuelve null
 * (no se inventan campos). `countriesAllowed` queda null salvo "worldwide/anywhere" explícito,
 * porque `locations` puede ser la sede y no una restricción.
 */
export function mapTorreJob(r: TorreResult): RawJob | null {
  const id = r.id?.trim();
  const title = r.objective?.trim();
  if (!id || !title) return null;

  const locations = (r.locations ?? []).map((l) => l.trim()).filter(Boolean);
  const modality = modalityOf(r);
  const label =
    modality === "remoto"
      ? "Remoto"
      : modality === "hibrido"
        ? "Híbrido"
        : modality === "presencial"
          ? "Presencial"
          : "Modalidad desconocida";
  const locationRaw = locations.length ? `${label} (${locations.join(", ")})` : label;
  const anywhere = modality === "remoto" && locations.some((l) => WORLDWIDE.test(l));

  const c = r.compensation;
  const min = c?.minAmount || null;
  const max = c?.maxAmount || null;
  const hasSalary = min !== null || max !== null;
  const currency = c?.currency?.trim().toUpperCase() ?? null;
  const usd = hasSalary && currency !== null && /^USD/.test(currency);
  const period = periodOf(c?.periodicity);
  let salaryNote: string | null = null;
  if (hasSalary) {
    salaryNote = usd
      ? `USD ${c?.periodicity ?? "período no indicado"} según Torre (a verificar)`
      : `${currency ?? "moneda no indicada"} ${min ?? "?"}–${max ?? "?"} ${c?.periodicity ?? "período no indicado"}`;
  }

  const jd = htmlToText(r.description);
  return {
    source: {
      kind: "other",
      name: "Torre",
      externalId: `torre:${id}`,
      url: `${TORRE_JOB_URL}/${encodeURIComponent(id)}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(r) },
    },
    title,
    companyRaw: r.organizations?.[0]?.name?.trim() || "desconocida",
    locationRaw,
    countriesAllowed: anywhere ? ["*"] : null,
    modality,
    contractType: r.type ?? null,
    salaryMinUsd: usd ? min : null,
    salaryMaxUsd: usd ? max : null,
    salaryPeriod: usd ? period : null,
    salaryNote,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: jd || null,
    postedAt: toDate(r.created),
    tags: (r.skills ?? []).map((s) => s.name?.trim() ?? "").filter(Boolean),
    seniority: null,
    lang: null,
  };
}

export type FetchTorreOptions = {
  /** Solo avisos creados desde esta fecha (filtro en cliente). */
  since: Date;
  size?: number;
  /** Tope de páginas, para acotar llamadas. */
  maxPages?: number;
  /** Body de filtros del buscador. */
  filters?: unknown;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchTorreResult = {
  jobs: RawJob[];
  pagesFetched: number;
  /** Resultados vistos antes de filtrar por fecha. */
  seen: number;
  /** Resultados sin id u objective, descartados. */
  skipped: number;
};

export function torreUrl(baseUrl: string, size: number, offset: number): string {
  return `${baseUrl}?size=${size}&offset=${offset}`;
}

/**
 * Pagina por offset; corta cuando una página entera es más vieja que `since` (supone orden por
 * fecha desc: a verificar), cuando se acaban los resultados o con `maxPages`.
 */
export async function fetchTorreJobs(options: FetchTorreOptions): Promise<FetchTorreResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? TORRE_BASE_URL;
  const size = options.size ?? 20;
  const maxPages = options.maxPages ?? 10;
  const filters = options.filters ?? TORRE_DEFAULT_FILTERS;
  const sinceMs = options.since.getTime();

  const byId = new Map<string, RawJob>();
  let pagesFetched = 0;
  let seen = 0;
  let skipped = 0;
  let offset = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchImpl(torreUrl(baseUrl, size, offset), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(filters),
    });
    if (!res.ok) throw new Error(`Torre offset ${offset}: HTTP ${res.status}`);
    const body = (await res.json()) as TorrePage;
    pagesFetched++;
    const items = body.results ?? [];
    seen += items.length;
    let olderThanWindow = 0;
    for (const item of items) {
      const created = toDate(item.created);
      if (created && created.getTime() < sinceMs) {
        olderThanWindow++;
        continue;
      }
      const raw = mapTorreJob(item);
      if (!raw) {
        skipped++;
        continue;
      }
      if (!byId.has(raw.source.externalId!)) byId.set(raw.source.externalId!, raw);
    }
    offset += items.length;
    const total = body.total ?? Infinity;
    if (items.length === 0 || offset >= total || olderThanWindow === items.length) break;
  }
  return { jobs: [...byId.values()], pagesFetched, seen, skipped };
}
