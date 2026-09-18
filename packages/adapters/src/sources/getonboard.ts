import type { Modality, RawJob } from "@job-search-os/pipeline";

/**
 * Get on Board, API pública v0 (sin key). Confirmado el 2026-09-10 con llamadas reales:
 * - `GET /api/v0/categories/<slug>/jobs?per_page=N&page=P&expand=[...]`: lista por categoría,
 *   ordenada por published_at desc (permite cortar cuando se pasa la ventana). Ni `remote=true`
 *   ni `category` filtran en ningún endpoint (search/jobs?category=x devuelve todas las
 *   categorías): remoto y fecha se filtran en cliente.
 * - `expand` trae inline company, tags (nombres), modality, seniority y location_tenants
 *   (países del aviso para remote_local). `published_at_from` no filtra: se filtra en cliente.
 * - `min_salary`/`max_salary` son USD mensuales. `applications_count` = candidatos.
 * - `GET /api/v0/jobs/<id>` requiere auth; las listas ya traen la descripción completa.
 */
export const GOB_BASE_URL = "https://www.getonbrd.com/api/v0";
export const GOB_CATEGORIES = [
  "programming",
  "machine-learning-ai",
  "data-science-analytics",
] as const;
export const GOB_EXPAND = ["company", "tags", "modality", "seniority", "location_tenants"] as const;

type Named = { data?: { id: string; attributes?: { name?: string } } | null };
type NamedList = { data?: { id: string; attributes?: { name?: string } }[] };

export type GobJobItem = {
  id: string;
  type: "job";
  attributes: {
    title: string;
    description_headline?: string | null;
    description?: string | null;
    functions_headline?: string | null;
    functions?: string | null;
    desirable_headline?: string | null;
    desirable?: string | null;
    benefits_headline?: string | null;
    benefits?: string | null;
    remote: boolean;
    remote_modality:
      "fully_remote" | "remote_local" | "temporarily_remote" | "hybrid" | "no_remote" | string;
    remote_zone?: string | null;
    countries?: string[] | null;
    lang?: string | null;
    category_name?: string | null;
    min_salary?: number | null;
    max_salary?: number | null;
    published_at: number;
    applications_count?: number | null;
    location_tenants?: NamedList;
    modality?: Named;
    seniority?: Named;
    tags?: NamedList;
    company?: Named;
  };
  links?: { public_url?: string };
};

export type GobPage = {
  data: GobJobItem[];
  meta?: { page: number; per_page: number; total_pages: number };
};

/** Slugs de location_tenants y nombres de countries → ISO-2. Lo que no se conoce queda en mayúsculas. */
export const COUNTRY_TO_ISO: Record<string, string> = {
  argentina: "AR",
  bolivia: "BO",
  brasil: "BR",
  brazil: "BR",
  chile: "CL",
  colombia: "CO",
  "costa-rica": "CR",
  "costa rica": "CR",
  "dominican-republic": "DO",
  ecuador: "EC",
  "el-salvador": "SV",
  "el salvador": "SV",
  guatemala: "GT",
  honduras: "HN",
  mexico: "MX",
  méxico: "MX",
  nicaragua: "NI",
  panama: "PA",
  panamá: "PA",
  paraguay: "PY",
  peru: "PE",
  perú: "PE",
  spain: "ES",
  españa: "ES",
  "united-states": "US",
  "united states": "US",
  uruguay: "UY",
  venezuela: "VE",
};

export function countryToIso(nameOrSlug: string): string {
  const key = nameOrSlug.trim().toLowerCase();
  return COUNTRY_TO_ISO[key] ?? COUNTRY_TO_ISO[key.replace(/\s+/g, "-")] ?? key.toUpperCase();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/** HTML de GoB → texto plano legible: viñetas, saltos de párrafo, sin tags ni entidades. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === "#") {
        const n =
          code[1]?.toLowerCase() === "x"
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function modalityOf(a: GobJobItem["attributes"]): Modality {
  switch (a.remote_modality) {
    case "fully_remote":
    case "remote_local":
    case "temporarily_remote":
      return "remoto";
    case "hybrid":
      return "hibrido";
    case "no_remote":
      return "presencial";
    default:
      return a.remote ? "remoto" : "desconocida";
  }
}

function section(
  headline: string | null | undefined,
  html: string | null | undefined,
): string | null {
  const body = htmlToText(html);
  if (!body) return null;
  return headline ? `${headline}\n${body}` : body;
}

/** Un item de la API → RawJob. Puro: no hace I/O. */
export function mapGobJob(item: GobJobItem, categorySlug: string): RawJob {
  const a = item.attributes;
  const tenants = (a.location_tenants?.data ?? []).map((t) => t.attributes?.name ?? t.id);
  const countries = (a.countries ?? []).filter((c) => c && c.toLowerCase() !== "remote");
  const modality = modalityOf(a);

  let locationRaw: string;
  let countriesAllowed: string[] | null;
  if (a.remote_modality === "fully_remote") {
    locationRaw = "Remoto (fully remote, work from anywhere)";
    countriesAllowed = ["*"];
  } else if (modality === "remoto") {
    const names = tenants.length ? tenants : countries;
    locationRaw = names.length
      ? `Remoto (${names.join(", ")})`
      : "Remoto (países no especificados)";
    countriesAllowed = names.length ? names.map(countryToIso) : null;
  } else {
    const label =
      modality === "hibrido"
        ? "Híbrido"
        : modality === "presencial"
          ? "Presencial"
          : "Modalidad desconocida";
    locationRaw = countries.length ? `${label} (${countries.join(", ")})` : label;
    countriesAllowed = countries.length ? countries.map(countryToIso) : null;
  }
  if (a.remote_zone) locationRaw += ` · zona: ${a.remote_zone}`;

  const jd = [
    section(a.functions_headline, a.functions),
    section(a.description_headline, a.description),
    section(a.desirable_headline, a.desirable),
    section(a.benefits_headline, a.benefits),
  ]
    .filter((s): s is string => s !== null)
    .join("\n\n");

  const hasSalary = a.min_salary != null || a.max_salary != null;
  return {
    source: {
      kind: "getonboard_api",
      name: `GoB ${categorySlug}`,
      externalId: item.id,
      url: item.links?.public_url ?? `https://www.getonbrd.com/jobs/${item.id}`,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title: a.title.trim(),
    companyRaw: a.company?.data?.attributes?.name?.trim() || a.company?.data?.id || "desconocida",
    locationRaw,
    countriesAllowed,
    modality,
    contractType: a.modality?.data?.attributes?.name ?? null,
    salaryMinUsd: a.min_salary ?? null,
    salaryMaxUsd: a.max_salary ?? null,
    salaryPeriod: hasSalary ? "mensual" : null,
    salaryNote: hasSalary ? "USD/mes según Get on Board" : null,
    weeklyHours: null,
    candidatesCount: a.applications_count ?? null,
    badges: [],
    jdText: jd || null,
    postedAt: a.published_at ? new Date(a.published_at * 1000) : null,
    tags: (a.tags?.data ?? []).map((t) => t.attributes?.name ?? t.id),
    seniority: a.seniority?.data?.attributes?.name ?? null,
    lang: a.lang && a.lang !== "lang_not_specified" ? a.lang : null,
  };
}

export type FetchGobOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente; la API no filtra por fecha). */
  since: Date;
  categories?: readonly string[];
  perPage?: number;
  /** Tope de páginas por categoría, para acotar llamadas. */
  maxPages?: number;
  /** Solo remotos (default true). */
  remoteOnly?: boolean;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchGobResult = {
  jobs: RawJob[];
  pagesFetched: number;
  /** Avisos vistos antes de filtrar por fecha y modalidad. */
  seen: number;
};

export function gobCategoryUrl(
  baseUrl: string,
  category: string,
  page: number,
  perPage: number,
): string {
  const expand = encodeURIComponent(JSON.stringify(GOB_EXPAND));
  return `${baseUrl}/categories/${encodeURIComponent(category)}/jobs?per_page=${perPage}&page=${page}&expand=${expand}`;
}

/**
 * Recorre las categorías configuradas página por página (published_at desc), se queda con los
 * remotos publicados desde `since` y corta cuando la página ya es más vieja que la ventana.
 * Deduplica por id entre categorías.
 */
export async function fetchGetOnBoardJobs(options: FetchGobOptions): Promise<FetchGobResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? GOB_BASE_URL;
  const categories = options.categories ?? GOB_CATEGORIES;
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 10;
  const remoteOnly = options.remoteOnly ?? true;
  const sinceMs = options.since.getTime();

  const byId = new Map<string, RawJob>();
  let pagesFetched = 0;
  let seen = 0;
  for (const category of categories) {
    for (let page = 1; page <= maxPages; page++) {
      const res = await fetchImpl(gobCategoryUrl(baseUrl, category, page, perPage), {
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Get on Board ${category} p${page}: HTTP ${res.status}`);
      const body = (await res.json()) as GobPage;
      pagesFetched++;
      const items = body.data ?? [];
      seen += items.length;
      let olderThanWindow = 0;
      for (const item of items) {
        if (item.attributes.published_at * 1000 < sinceMs) {
          olderThanWindow++;
          continue;
        }
        if (remoteOnly && !item.attributes.remote) continue;
        if (!byId.has(item.id)) byId.set(item.id, mapGobJob(item, category));
      }
      const totalPages = body.meta?.total_pages ?? page;
      // Orden published_at desc: si toda la página quedó fuera de la ventana, lo que sigue también
      if (page >= totalPages || items.length === 0 || olderThanWindow === items.length) break;
    }
  }
  return { jobs: [...byId.values()], pagesFetched, seen };
}
