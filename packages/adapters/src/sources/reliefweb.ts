import type { Modality, RawJob } from "@job-search-os/pipeline";
import { countryToIso, htmlToText } from "./getonboard";

/**
 * ReliefWeb, API REST pública v2 operada por UN OCHA.
 * - Endpoint: `GET https://api.reliefweb.int/v2/jobs` (o POST con JSON).
 * - Requiere obligatoriamente registrar y pasar el parámetro `appname` (ej. `?appname=job-search-os`).
 * - Por defecto permanece APAGADO: si no se provee `appname` ni existe `process.env.RELIEFWEB_APPNAME`,
 *   no realiza ninguna llamada de red y retorna inmediatamente un resultado vacío.
 * - Licenciado bajo Creative Commons Attribution 4.0 International (CC BY 4.0).
 * - Ver ADR-028 (docs/adr/028-fuente-reliefweb.md) y docs/sources/reliefweb.md.
 */
export const RELIEFWEB_BASE_URL = "https://api.reliefweb.int/v2/jobs";

export const RELIEFWEB_ISO3_TO_ISO2: Record<string, string> = {
  ARG: "AR",
  BOL: "BO",
  BRA: "BR",
  CHL: "CL",
  COL: "CO",
  CRI: "CR",
  CUB: "CU",
  DOM: "DO",
  ECU: "EC",
  SLV: "SV",
  GTM: "GT",
  HND: "HN",
  MEX: "MX",
  NIC: "NI",
  PAN: "PA",
  PRY: "PY",
  PER: "PE",
  ESP: "ES",
  USA: "US",
  URY: "UY",
  VEN: "VE",
  HTI: "HT",
};

export type ReliefWebSourceItem = {
  id?: number;
  name?: string | null;
  shortname?: string | null;
};

export type ReliefWebCountryItem = {
  id?: number;
  name?: string | null;
  iso3?: string | null;
};

export type ReliefWebCategoryItem = {
  id?: number;
  name?: string | null;
};

export type ReliefWebJobTypeItem = {
  id?: number;
  name?: string | null;
};

export type ReliefWebFields = {
  title?: string | null;
  body?: string | null;
  url?: string | null;
  date?: {
    created?: string | null;
    closing?: string | null;
  } | null;
  source?: ReliefWebSourceItem[] | null;
  country?: ReliefWebCountryItem[] | null;
  career_categories?: ReliefWebCategoryItem[] | null;
  job_type?: ReliefWebJobTypeItem | null;
  how_to_apply?: string | null;
};

export type ReliefWebItem = {
  id?: string | number | null;
  score?: number | null;
  fields?: ReliefWebFields | null;
};

export type ReliefWebPage = {
  time?: number;
  totalCount?: number;
  count?: number;
  data?: ReliefWebItem[];
};

const REMOTE_REGEX =
  /\b(home-?based|telework(ing)?|teletrabajo|trabajo remoto|remote work|remoto)\b/i;

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function resolveModalityAndLocation(fields: ReliefWebFields | null | undefined): {
  modality: Modality;
  locationRaw: string;
  countriesAllowed: string[] | null;
} {
  const countries = fields?.country ?? [];
  const countryNames = countries.map((c) => c.name?.trim()).filter(Boolean) as string[];

  const textToScan = [fields?.title ?? "", fields?.body ?? "", ...countryNames].join(" ");
  const isRemote = REMOTE_REGEX.test(textToScan);

  if (isRemote) {
    // Si es remoto/home-based, no se asume restricción ciega al país de la oficina para evitar
    // falsos descartes de la regla H-1 (PR #300). Queda en null para señalar location_risk.
    const locationRaw = countryNames.length
      ? `Remoto (home-based - ${countryNames.join(", ")})`
      : "Remoto (home-based)";
    return {
      modality: "remoto",
      locationRaw,
      countriesAllowed: null,
    };
  }

  if (countries.length > 0) {
    const iso2List: string[] = [];
    for (const c of countries) {
      const iso3 = c.iso3?.trim().toUpperCase();
      if (iso3 && RELIEFWEB_ISO3_TO_ISO2[iso3]) {
        iso2List.push(RELIEFWEB_ISO3_TO_ISO2[iso3]);
      } else if (c.name) {
        const mapped = countryToIso(c.name);
        if (/^[A-Z]{2}$/.test(mapped)) iso2List.push(mapped);
      }
    }

    return {
      modality: "presencial",
      locationRaw: countryNames.join(", ") || "Presencial",
      countriesAllowed: iso2List.length > 0 ? Array.from(new Set(iso2List)) : null,
    };
  }

  return {
    modality: "desconocida",
    locationRaw: "Ubicación no especificada",
    countriesAllowed: null,
  };
}

/**
 * Mapea un item de ReliefWeb API v2 a RawJob.
 * Función pura sin I/O. Falla cerrado: si falta `id` o `title`, devuelve null.
 */
export function mapReliefWebJob(item: ReliefWebItem): RawJob | null {
  const id = item.id !== null && item.id !== undefined ? String(item.id).trim() : "";
  const title = item.fields?.title?.trim() ?? "";
  if (!id || !title) return null;

  const fields = item.fields;
  const companyRaw = fields?.source?.[0]?.name?.trim() || "desconocida";
  const { modality, locationRaw, countriesAllowed } = resolveModalityAndLocation(fields);
  const jdText = htmlToText(fields?.body) || null;
  const postedAt = toDate(fields?.date?.created);
  const categories = (fields?.career_categories ?? [])
    .map((c) => c.name?.trim())
    .filter(Boolean) as string[];
  const contractType = fields?.job_type?.name?.trim() || null;

  return {
    source: {
      kind: "other",
      name: "ReliefWeb",
      externalId: `reliefweb:${id}`,
      url: fields?.url?.trim() || null,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title,
    companyRaw,
    locationRaw,
    countriesAllowed,
    modality,
    contractType,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText,
    postedAt,
    tags: [...categories],
    categories: [...categories],
    seniority: null,
    lang: null,
  };
}

export function reliefwebUrl(
  baseUrl: string,
  appname: string,
  limit: number,
  offset: number,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("appname", appname);
  url.searchParams.set("profile", "full");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.append("sort[]", "date.created:desc");
  url.searchParams.append("fields[include][]", "title");
  url.searchParams.append("fields[include][]", "body");
  url.searchParams.append("fields[include][]", "url");
  url.searchParams.append("fields[include][]", "date.created");
  url.searchParams.append("fields[include][]", "source");
  url.searchParams.append("fields[include][]", "country");
  url.searchParams.append("fields[include][]", "career_categories");
  url.searchParams.append("fields[include][]", "job_type");
  url.searchParams.append("fields[include][]", "how_to_apply");
  return url.toString();
}

export type FetchReliefWebOptions = {
  /** Identificador de aplicación registrado ante UN OCHA. Requerido para llamar a la API. */
  appname?: string;
  /** Solo avisos creados desde esta fecha. */
  since?: Date;
  limit?: number;
  /** Tope de páginas por consulta para acotar peticiones. */
  maxPages?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchReliefWebResult = {
  jobs: RawJob[];
  pagesFetched: number;
  seen: number;
  skipped: number;
  /** true si la fuente no realizó llamadas por falta de appname (apagado por defecto). */
  disabled: boolean;
};

/**
 * Consulta la API v2 de ReliefWeb.
 * APAGADO POR DEFECTO: Si no se provee `appname` (en options o via RELIEFWEB_APPNAME en entorno),
 * no realiza ninguna llamada a la red y devuelve un resultado vacío.
 */
export async function fetchReliefWebJobs(
  options: FetchReliefWebOptions = {},
): Promise<FetchReliefWebResult> {
  const appname = (options.appname || process.env.RELIEFWEB_APPNAME || "").trim();
  if (!appname) {
    return {
      jobs: [],
      pagesFetched: 0,
      seen: 0,
      skipped: 0,
      disabled: true,
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? RELIEFWEB_BASE_URL;
  const limit = options.limit ?? 20;
  const maxPages = options.maxPages ?? 10;
  const sinceMs = options.since ? options.since.getTime() : null;

  const byId = new Map<string, RawJob>();
  let pagesFetched = 0;
  let seen = 0;
  let skipped = 0;
  let offset = 0;

  const headers: Record<string, string> = { accept: "application/json" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;

  for (let page = 1; page <= maxPages; page++) {
    const url = reliefwebUrl(baseUrl, appname, limit, offset);
    const res = await fetchImpl(url, { headers });
    if (!res.ok) {
      throw new Error(`ReliefWeb offset ${offset}: HTTP ${res.status}`);
    }

    const body = (await res.json()) as ReliefWebPage;
    pagesFetched++;
    const items = body.data ?? [];
    seen += items.length;

    let olderThanWindow = 0;
    for (const item of items) {
      const posted = toDate(item.fields?.date?.created);
      if (sinceMs !== null && posted && posted.getTime() < sinceMs) {
        olderThanWindow++;
        continue;
      }

      const raw = mapReliefWebJob(item);
      if (!raw) {
        skipped++;
        continue;
      }

      if (!byId.has(raw.source.externalId!)) {
        byId.set(raw.source.externalId!, raw);
      }
    }

    offset += items.length;
    const total = body.totalCount ?? Infinity;
    if (items.length === 0 || offset >= total || olderThanWindow === items.length) {
      break;
    }
  }

  return {
    jobs: [...byId.values()],
    pagesFetched,
    seen,
    skipped,
    disabled: false,
  };
}
