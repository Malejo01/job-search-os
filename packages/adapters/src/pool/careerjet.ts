import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { salaryOriginalFromText, siteOrigin, type RawJob } from "@job-search-os/pipeline";
import type { SourceErrorCode } from "../sources/error-code";
import { SOURCE_USER_AGENT_BASE } from "../sources/user-agent";
import { planJoobleQueries, type JoobleQuery } from "./jooble";

/**
 * Careerjet (API pública para editores, `es_AR`) como fuente del pool de Argentina. ADR-039, ampliación
 * de R16-1. Mismo patrón que Jooble (`jooble.ts`).
 *
 * APAGADO POR DEFECTO y FALLA CERRADO:
 * - Sin `CAREERJET_AFFID`, sin `CAREERJET_CALLER_IP` (la IP de quien llama) o sin `SITE_URL` no hace ninguna
 *   llamada de red y no devuelve ofertas.
 * - Solo participa si `careerjet` está en `POOL_SOURCES` (`parsePoolSources`, en `fetch.ts`).
 * - Una respuesta con forma inesperada se descarta entera: nunca extracción parcial.
 * - Lo que la API no dice queda `null` (en particular `countriesAllowed`).
 *
 * BLOQUEO PARA PRENDERLA: la API pide la IP y el navegador de la persona que busca y la URL de la página
 * donde se muestra el aviso. El pool corre en un cron: no hay ninguna persona del otro lado. NO se inventa
 * una IP ni un navegador y no se manda el de una persona real: `user_ip` es la IP de este servidor (variable
 * explícita), `user_agent` es el identificable de la app y `url` sale de `SITE_URL`. Si Careerjet no permite
 * ese uso (sin visitante), esta fuente no se puede usar para el pool.
 *
 * La API da un fragmento (`description`), no la descripción: NO va a `jdText` (la oferta queda «pendiente de
 * descripción»). El afiliado viaja en la query: la URL nunca se loguea ni va a un mensaje de error.
 *
 * Todo lo del formato (endpoint, parámetros, campos) sale de la documentación pública y está **a verificar
 * al registrarse**: no se probó contra la API real.
 */
export const CAREERJET_BASE_URL = "https://public.api.careerjet.net/search";
export const CAREERJET_SOURCE_NAME = "Careerjet";
export const CAREERJET_LOCALE = "es_AR";
export const CAREERJET_LOCATION = "Argentina";

/** Mismos topes que Jooble, como supuesto a verificar: Careerjet no publica un tope diario que conozcamos. */
export const CAREERJET_DAILY_QUERY_CAP = 100;
export const CAREERJET_MIN_INTERVAL_MS = 5 * 3_600_000;
export const CAREERJET_MAX_RUNS_PER_DAY = Math.ceil((24 * 3_600_000) / CAREERJET_MIN_INTERVAL_MS);
export const CAREERJET_QUERIES_PER_RUN = 15;
export const CAREERJET_WORST_CASE_DAILY_QUERIES =
  CAREERJET_QUERIES_PER_RUN * CAREERJET_MAX_RUNS_PER_DAY;

export type CareerjetQuery = JoobleQuery;

/** Plan de consultas de una corrida: el mismo de Jooble (palabras de `portal-guide.ts`), con topes propios. */
export function planCareerjetQueries(
  options: { roles?: readonly string[]; rotation?: number; maxQueries?: number } = {},
): CareerjetQuery[] {
  return planJoobleQueries({
    ...options,
    maxQueries: Math.min(
      Math.floor(options.maxQueries ?? CAREERJET_QUERIES_PER_RUN),
      CAREERJET_DAILY_QUERY_CAP,
    ),
  });
}

/** Item de la respuesta, tal como lo documenta Careerjet (a verificar al registrarse). */
export type CareerjetItem = {
  id?: string | number | null;
  title?: string | null;
  company?: string | null;
  locations?: string | null;
  description?: string | null;
  salary?: string | null;
  site?: string | null;
  date?: string | null;
  url?: string | null;
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const STRING_FIELDS = [
  "title",
  "company",
  "locations",
  "description",
  "salary",
  "site",
  "date",
  "url",
] as const;

/**
 * Valida la forma de la página. Falla cerrado: si el cuerpo no es un objeto con `jobs` array (una respuesta
 * de error o de ubicación ambigua no la tiene), o algún item no es un objeto o trae un campo con tipo
 * equivocado, devuelve `null` y la página entera se descarta.
 */
export function parseCareerjetPage(body: unknown): CareerjetItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.jobs)) return null;
  const items: CareerjetItem[] = [];
  for (const raw of body.jobs) {
    if (!isRecord(raw)) return null;
    for (const f of STRING_FIELDS) {
      const v = raw[f];
      if (v !== undefined && v !== null && typeof v !== "string") return null;
    }
    const id = raw.id;
    if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number")
      return null;
    items.push(raw as CareerjetItem);
  }
  return items;
}

function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDate(value: string | null | undefined): Date | null {
  const t = (value ?? "").trim();
  if (!t) return null;
  // La fecha de ejemplo de la documentación es RFC 822 con zona; una ISO sin zona se toma como UTC
  const d = new Date(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(t) ? `${t}Z` : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function httpUrl(link: string | null | undefined): string | null {
  const t = (link ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

/**
 * Mapea un item a `RawJob`, o `null` si falta lo mínimo: título y link http(s) al aviso (sin link no hay a
 * dónde llevar a la persona). El id: el `id` de la API si lo trae; si no, un hash estable del link (a
 * verificar si Careerjet da un id propio). `jdText` queda `null`.
 */
export function mapCareerjetJob(item: CareerjetItem): RawJob | null {
  const title = clean(item.title);
  const url = httpUrl(item.url);
  if (!title || !url) return null;
  const own = item.id !== null && item.id !== undefined ? String(item.id).trim() : "";
  const id = own || createHash("sha256").update(url).digest("hex").slice(0, 32);
  const location = clean(item.locations);
  const salary = clean(item.salary);
  return {
    source: {
      kind: "other",
      name: CAREERJET_SOURCE_NAME,
      externalId: `careerjet:${id}`,
      url,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title: title.slice(0, 300),
    companyRaw: clean(item.company).slice(0, 300) || "desconocida",
    locationRaw: location.slice(0, 300) || null,
    countriesAllowed: null,
    modality: "desconocida",
    contractType: null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: salary.slice(0, 200) || null,
    salaryOriginal: salaryOriginalFromText(salary.slice(0, 200)),
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: null,
    postedAt: toDate(item.date),
    tags: [],
    categories: [],
    seniority: null,
    lang: null,
  };
}

/** Por qué la fuente no hizo ninguna llamada. */
export type CareerjetDisabledReason = "sin_affid" | "sin_ip" | "sin_url";

export type FetchCareerjetOptions = {
  /** Si no viene, se lee `CAREERJET_AFFID`. */
  affid?: string;
  /** IP de quien llama (este servidor). Si no viene, se lee `CAREERJET_CALLER_IP`. Nunca se inventa. */
  callerIp?: string;
  /** Origen público del sitio (`url` de la API). Si no viene, sale de `SITE_URL`. */
  pageUrl?: string;
  queries?: readonly CareerjetQuery[];
  maxQueries?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchCareerjetResult = {
  jobs: RawJob[];
  queriesMade: number;
  seen: number;
  skipped: number;
  discardedPages: number;
  disabled: boolean;
  disabledReason: CareerjetDisabledReason | null;
  /** Solo el número de estado HTTP, nunca la URL (lleva el afiliado). */
  stoppedByStatus: number | null;
  stoppedByError: SourceErrorCode | null;
};

/** Datos de la persona que consulta que exige la API, resueltos del entorno o `null` (fuente apagada). */
export function resolveCareerjetCaller(
  options: Pick<FetchCareerjetOptions, "affid" | "callerIp" | "pageUrl"> = {},
  env: Record<string, string | undefined> = process.env,
):
  | { ok: true; affid: string; callerIp: string; pageUrl: string }
  | { ok: false; reason: CareerjetDisabledReason } {
  const affid = (options.affid ?? env.CAREERJET_AFFID ?? "").trim();
  if (!affid) return { ok: false, reason: "sin_affid" };
  const callerIp = (options.callerIp ?? env.CAREERJET_CALLER_IP ?? "").trim();
  if (!callerIp || isIP(callerIp) === 0) return { ok: false, reason: "sin_ip" };
  const pageUrl = options.pageUrl ?? siteOrigin(env as Record<string, string>);
  if (!pageUrl) return { ok: false, reason: "sin_url" };
  return { ok: true, affid, callerIp, pageUrl };
}

/**
 * Consulta la API de Careerjet, una página por consulta, y se detiene ante el primer error HTTP. Sin
 * afiliado, IP o URL del sitio no llama a la red. Respeta `min(maxQueries, CAREERJET_DAILY_QUERY_CAP)`.
 */
export async function fetchCareerjetJobs(
  options: FetchCareerjetOptions = {},
): Promise<FetchCareerjetResult> {
  const empty: FetchCareerjetResult = {
    jobs: [],
    queriesMade: 0,
    seen: 0,
    skipped: 0,
    discardedPages: 0,
    disabled: true,
    disabledReason: null,
    stoppedByStatus: null,
    stoppedByError: null,
  };
  const caller = resolveCareerjetCaller(options);
  if (!caller.ok) return { ...empty, disabledReason: caller.reason };

  const cap = Math.min(
    Math.max(0, Math.floor(options.maxQueries ?? CAREERJET_QUERIES_PER_RUN)),
    CAREERJET_DAILY_QUERY_CAP,
  );
  const queries = (options.queries ?? planCareerjetQueries({ maxQueries: cap })).slice(0, cap);
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? SOURCE_USER_AGENT_BASE;
  const headers = { accept: "application/json", "user-agent": userAgent };

  const byId = new Map<string, RawJob>();
  const result: FetchCareerjetResult = { ...empty, disabled: false };
  for (const q of queries) {
    result.queriesMade++;
    const url = new URL(options.baseUrl ?? CAREERJET_BASE_URL);
    url.searchParams.set("locale_code", CAREERJET_LOCALE);
    url.searchParams.set("keywords", q.keywords);
    url.searchParams.set("location", CAREERJET_LOCATION);
    url.searchParams.set("page", "1");
    url.searchParams.set("affid", caller.affid);
    // Datos de quien llama: el servidor, no una persona (ver el bloqueo en el encabezado)
    url.searchParams.set("user_ip", caller.callerIp);
    url.searchParams.set("user_agent", userAgent);
    url.searchParams.set("url", caller.pageUrl);
    let res: Response;
    try {
      res = await fetchImpl(url.toString(), { method: "GET", headers });
    } catch (e) {
      // El mensaje de un fallo de red puede traer la URL (con el afiliado): solo el código cerrado.
      result.stoppedByError =
        e instanceof Error && /timeout|abort/i.test(`${e.name} ${e.message}`)
          ? "timeout"
          : "unknown";
      break;
    }
    if (!res.ok) {
      result.stoppedByStatus = res.status;
      break;
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      result.discardedPages++;
      continue;
    }
    const items = parseCareerjetPage(body);
    if (!items) {
      result.discardedPages++;
      continue;
    }
    result.seen += items.length;
    for (const item of items) {
      const raw = mapCareerjetJob(item);
      if (!raw) {
        result.skipped++;
        continue;
      }
      if (!byId.has(raw.source.externalId!)) byId.set(raw.source.externalId!, raw);
    }
  }
  result.jobs = [...byId.values()];
  return result;
}
