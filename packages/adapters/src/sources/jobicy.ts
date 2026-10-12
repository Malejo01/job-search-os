import type { RawJob } from "@job-search-os/pipeline";
import { COUNTRY_TO_ISO, countryToIso, htmlToText } from "./getonboard";

/**
 * Jobicy, API pública de avisos remotos. FORMATO A VERIFICAR: sale de su documentación pública
 * (https://jobicy.com/jobs-rss-feed), sin llamada real (ronda 37, sin red). Ver docs/sources/jobicy.md.
 * - `GET https://jobicy.com/api/v2/remote-jobs?count=N` → `{ jobs: [...] }` (otros campos se ignoran).
 *   Una sola llamada por corrida, sin `industry` ni `geo`. Ventana de la fuente: 7 días.
 * - Términos (ops/rondas/37-38-39/informes/riesgos-fuentes.md, consultado el 2026-10-12): máximo una
 *   pasada automatizada por hora; "Please credit Jobicy and link to the source"; "Keep Jobicy as the
 *   original source and preserve the canonical Jobicy job URL when displaying listings". Por eso
 *   `source.url` es la URL de la fuente tal cual y quien muestre el aviso debe decir "Jobicy" y
 *   enlazar a ella. No presentar los avisos como propios.
 * - `externalId` es el id de la fuente sin prefijo: la unicidad la da `source.kind`.
 * - Salario: solo USD llena los campos que lee `decide()`; otra moneda o sin moneda va en `salaryNote`
 *   (D-017: lo que la fuente no dice no se supone).
 */
export const JOBICY_BASE_URL = "https://jobicy.com/api/v2/remote-jobs";

export type JobicyItem = {
  id?: string | number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string | string[];
  jobType?: string | string[];
  jobGeo?: string | string[];
  jobLevel?: string;
  jobDescription?: string;
  pubDate?: string;
  salaryCurrency?: string;
  annualSalaryMin?: number | string;
  annualSalaryMax?: number | string;
  [key: string]: unknown;
};

const WORLDWIDE = /^(worldwide|anywhere)$/i;

function strings(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.filter((v): v is string => typeof v === "string").map((v) => v.trim());
}

/** "Data Science & Analytics" → "data-science-analytics". */
function slugify(value: string): string {
  return htmlToText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * `pubDate` en ISO (con o sin zona) o `"YYYY-MM-DD HH:MM:SS"`. Sin zona se toma como UTC.
 * Inválida → null.
 */
export function parseJobicyDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = `${s.replace(" ", "T")}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * `jobGeo` → países permitidos. Solo "Anywhere"/"Worldwide" y nombres de país conocidos dan un
 * valor; una región ("Europe"), una lista o vacío quedan en null (el prefiltro marca el riesgo).
 */
function geoOf(geo: string | string[] | undefined): {
  locationRaw: string;
  countriesAllowed: string[] | null;
} {
  const names = strings(geo).filter(Boolean);
  if (names.length === 0) {
    return { locationRaw: "Remoto (países no especificados)", countriesAllowed: null };
  }
  const locationRaw = `Remoto (${names.join(", ")})`;
  if (names.length > 1) return { locationRaw, countriesAllowed: null };
  const name = names[0]!;
  if (WORLDWIDE.test(name)) return { locationRaw, countriesAllowed: ["*"] };
  const key = name.toLowerCase();
  const known = key in COUNTRY_TO_ISO || key.replace(/\s+/g, "-") in COUNTRY_TO_ISO;
  const iso = known ? countryToIso(name) : null;
  return { locationRaw, countriesAllowed: iso && /^[A-Z]{2}$/.test(iso) ? [iso] : null };
}

/** Un aviso → RawJob. Puro. Falla cerrado: sin `id`, `url` o `jobTitle` devuelve null. */
export function mapJobicyJob(item: JobicyItem): RawJob | null {
  const id = item.id != null && String(item.id).trim() ? String(item.id).trim() : null;
  const url = typeof item.url === "string" && item.url.trim() ? item.url : null;
  const title = typeof item.jobTitle === "string" ? htmlToText(item.jobTitle) : "";
  if (!id || !url || !title) return null;

  const { locationRaw, countriesAllowed } = geoOf(item.jobGeo);
  const min = positiveNumber(item.annualSalaryMin);
  const max = positiveNumber(item.annualSalaryMax);
  const hasSalary = min !== null || max !== null;
  const currency =
    typeof item.salaryCurrency === "string" && item.salaryCurrency.trim()
      ? item.salaryCurrency.trim().toUpperCase()
      : null;
  const isUsd = hasSalary && currency === "USD";

  const jobType = strings(item.jobType).filter(Boolean);
  const industries = [...new Set(strings(item.jobIndustry).map(slugify).filter(Boolean))];
  const level = typeof item.jobLevel === "string" ? item.jobLevel.trim() : "";
  const company = typeof item.companyName === "string" ? htmlToText(item.companyName) : "";

  return {
    source: {
      kind: "jobicy",
      name: "Jobicy",
      externalId: id,
      url,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title,
    companyRaw: company || "desconocida",
    locationRaw,
    countriesAllowed,
    modality: "remoto",
    contractType: jobType.length ? jobType.join(", ") : null,
    salaryMinUsd: isUsd ? min : null,
    salaryMaxUsd: isUsd ? max : null,
    salaryPeriod: isUsd ? "anual" : null,
    salaryNote:
      hasSalary && !isUsd
        ? `${currency ?? "moneda no indicada"} ${min ?? "?"}–${max ?? "?"} por año según Jobicy`
        : null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: htmlToText(item.jobDescription) || null,
    postedAt: parseJobicyDate(item.pubDate),
    tags: [],
    seniority: level || null,
    lang: null,
    categories: industries,
  };
}

export type FetchJobicyOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente por `pubDate`). */
  since: Date;
  /** Avisos pedidos en la única llamada (la API admite 1 a 200). */
  count?: number;
  /** Si viene, se manda como cabecera `user-agent`. */
  userAgent?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchJobicyResult = {
  jobs: RawJob[];
  /** Avisos vistos antes de filtrar. */
  seen: number;
  /** Avisos descartados por estructura incompleta o `pubDate` inválida. */
  skipped: number;
};

/** Una sola llamada (la fuente pide como máximo una pasada por hora); filtra por fecha en cliente. */
export async function fetchJobicyJobs(options: FetchJobicyOptions): Promise<FetchJobicyResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? JOBICY_BASE_URL;
  const count = options.count ?? 200;
  const sinceMs = options.since.getTime();

  const headers: Record<string, string> = { accept: "application/json" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;
  const res = await fetchImpl(`${baseUrl}?count=${count}`, { headers });
  if (!res.ok) throw new Error(`Jobicy: HTTP ${res.status}`);
  const body = (await res.json()) as { jobs?: unknown } | null;
  const items = body?.jobs;
  if (!Array.isArray(items)) throw new Error("Jobicy: respuesta inesperada");

  const byId = new Map<string, RawJob>();
  let skipped = 0;
  for (const item of items as JobicyItem[]) {
    const raw = item && typeof item === "object" ? mapJobicyJob(item) : null;
    if (!raw || !raw.postedAt) {
      skipped++;
      continue;
    }
    if (raw.postedAt.getTime() < sinceMs) continue;
    if (!byId.has(raw.source.externalId!)) byId.set(raw.source.externalId!, raw);
  }
  return { jobs: [...byId.values()], seen: items.length, skipped };
}
