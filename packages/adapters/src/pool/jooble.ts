import { alertKeywordsFor, ROLE_KEYS, type RawJob } from "@job-search-os/pipeline";
import type { SourceErrorCode } from "../sources/error-code";
import { SOURCE_USER_AGENT_BASE } from "../sources/user-agent";

/**
 * Jooble (API para editores) como fuente del pool de Argentina. ADR-039, estado: propuesta.
 *
 * APAGADO POR DEFECTO y FALLA CERRADO:
 * - Sin `JOOBLE_API_KEY` no hace ninguna llamada de red y no devuelve ofertas.
 * - Solo participa si `jooble` está en `POOL_SOURCES` (`parsePoolSources`, en `fetch.ts`).
 * - Una respuesta con forma inesperada se descarta entera: nunca extracción parcial.
 * - Lo que la API no dice queda `null` (en particular `countriesAllowed`).
 *
 * La API devuelve un fragmento (`snippet`), no la descripción: el fragmento NO va a `jdText`, así
 * la oferta queda «pendiente de descripción» y la persona pega el texto completo. La clave viaja
 * en el path de la URL: la URL nunca se loguea ni va a un mensaje de error.
 *
 * Todo lo del formato de la respuesta sale de la documentación pública y está **a verificar al
 * registrarse**: no se probó contra la API real.
 */
export const JOOBLE_BASE_URL = "https://jooble.org/api";
export const JOOBLE_SOURCE_NAME = "Jooble";
export const JOOBLE_LOCATION = "Argentina";

/** Tope diario de consultas de la cuenta (ADR-039). */
export const JOOBLE_DAILY_QUERY_CAP = 100;
/** Intervalo mínimo entre corridas: como mucho 5 en 24 h (0, 5, 10, 15 y 20 h). */
export const JOOBLE_MIN_INTERVAL_MS = 5 * 3_600_000;
export const JOOBLE_MAX_RUNS_PER_DAY = Math.ceil((24 * 3_600_000) / JOOBLE_MIN_INTERVAL_MS);
/** Consultas por corrida: 5 corridas × 15 = 75, y quedan 25 para pruebas manuales. */
export const JOOBLE_QUERIES_PER_RUN = 15;
/** Palabras por carrera (las primeras de `ALERT_KEYWORDS`, en español). */
export const JOOBLE_KEYWORDS_PER_ROLE = 2;

/** Consultas por día si corre todas las veces que el intervalo permite. */
export const JOOBLE_WORST_CASE_DAILY_QUERIES = JOOBLE_QUERIES_PER_RUN * JOOBLE_MAX_RUNS_PER_DAY;

export type JoobleQuery = { role: string; keywords: string };

/**
 * Plan de consultas de UNA corrida: carreras × palabras de `portal-guide.ts`, intercaladas (primero
 * la palabra principal de cada carrera) y rotadas con `rotation` para cubrir todas a lo largo del
 * día. Nunca devuelve más de `min(maxQueries, JOOBLE_DAILY_QUERY_CAP)` consultas.
 */
export function planJoobleQueries(
  options: {
    roles?: readonly string[];
    rotation?: number;
    maxQueries?: number;
  } = {},
): JoobleQuery[] {
  const roles = options.roles ?? ROLE_KEYS;
  const cap = Math.max(
    0,
    Math.min(Math.floor(options.maxQueries ?? JOOBLE_QUERIES_PER_RUN), JOOBLE_DAILY_QUERY_CAP),
  );
  const perRole = roles.map((role) => ({
    role,
    words: alertKeywordsFor([role], "es").slice(0, JOOBLE_KEYWORDS_PER_ROLE),
  }));
  const all: JoobleQuery[] = [];
  for (let i = 0; i < JOOBLE_KEYWORDS_PER_ROLE; i++) {
    for (const { role, words } of perRole) {
      const w = words[i];
      if (w) all.push({ role, keywords: w });
    }
  }
  if (all.length === 0 || cap === 0) return [];
  const n = Math.min(cap, all.length);
  const rotation = Math.max(0, Math.floor(options.rotation ?? 0));
  const start = (rotation * n) % all.length;
  return Array.from({ length: n }, (_, k) => all[(start + k) % all.length]!);
}

/** Item de la respuesta, tal como lo documenta Jooble (a verificar al registrarse). */
export type JoobleItem = {
  id?: string | number | null;
  title?: string | null;
  location?: string | null;
  snippet?: string | null;
  salary?: string | null;
  source?: string | null;
  type?: string | null;
  link?: string | null;
  company?: string | null;
  updated?: string | null;
};

export type JooblePage = { totalCount?: number; jobs?: JoobleItem[] };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const STRING_FIELDS = [
  "title",
  "location",
  "snippet",
  "salary",
  "source",
  "type",
  "link",
  "company",
  "updated",
] as const;

/**
 * Valida la forma de la página. Falla cerrado: si el cuerpo no es un objeto con `jobs` array, o
 * algún item no es un objeto o trae un campo con tipo equivocado, devuelve `null` y la página entera
 * se descarta (nada de extracción parcial).
 */
export function parseJooblePage(body: unknown): JoobleItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.jobs)) return null;
  const items: JoobleItem[] = [];
  for (const raw of body.jobs) {
    if (!isRecord(raw)) return null;
    for (const f of STRING_FIELDS) {
      const v = raw[f];
      if (v !== undefined && v !== null && typeof v !== "string") return null;
    }
    const id = raw.id;
    if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number")
      return null;
    items.push(raw as JoobleItem);
  }
  return items;
}

function clean(s: string | null | undefined): string {
  return (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  // La fecha de ejemplo de la documentación no trae zona: se toma como UTC para que el resultado no
  // dependa de la máquina (a verificar al registrarse).
  const t = iso.trim();
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(t) ? t : `${t}Z`);
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
 * Mapea un item a `RawJob`, o `null` si falta lo mínimo: id, título y link http(s) al original
 * (ADR-014 y ADR-039: sin link no hay a dónde llevar a la persona). `jdText` queda `null`.
 */
export function mapJoobleJob(item: JoobleItem): RawJob | null {
  const id = item.id !== null && item.id !== undefined ? String(item.id).trim() : "";
  const title = clean(item.title);
  const url = httpUrl(item.link);
  if (!id || !title || !url) return null;
  const location = clean(item.location);
  const salary = clean(item.salary);
  const contractType = clean(item.type);
  return {
    source: {
      kind: "other",
      name: JOOBLE_SOURCE_NAME,
      externalId: `jooble:${id}`,
      url,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title,
    companyRaw: clean(item.company) || "desconocida",
    locationRaw: location || null,
    countriesAllowed: null,
    modality: "desconocida",
    contractType: contractType || null,
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: salary || null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: null,
    postedAt: toDate(item.updated),
    tags: [],
    categories: [],
    seniority: null,
    lang: null,
  };
}

export type FetchJoobleOptions = {
  /** Si no viene, se lee `JOOBLE_API_KEY`. Sin clave: no hace nada. */
  apiKey?: string;
  queries?: readonly JoobleQuery[];
  /** Consultas permitidas en esta corrida; nunca pasa del tope diario. */
  maxQueries?: number;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchJoobleResult = {
  jobs: RawJob[];
  queriesMade: number;
  seen: number;
  skipped: number;
  /** Páginas descartadas enteras por forma inesperada. */
  discardedPages: number;
  /** true si no hubo clave y no se hizo ninguna llamada. */
  disabled: boolean;
  /** Se cortó por un HTTP 429 o 4xx/5xx; solo el número, nunca la URL (lleva la clave). */
  stoppedByStatus: number | null;
  /** Se cortó por un fallo de red o timeout: solo el código cerrado, nunca el mensaje. */
  stoppedByError: SourceErrorCode | null;
};

/**
 * Consulta la API de Jooble, una página por consulta, y se detiene ante el primer error HTTP.
 * Respeta `min(maxQueries, JOOBLE_DAILY_QUERY_CAP)`; el plan por defecto sale de
 * `planJoobleQueries`.
 */
export async function fetchJoobleJobs(
  options: FetchJoobleOptions = {},
): Promise<FetchJoobleResult> {
  const apiKey = (options.apiKey ?? process.env.JOOBLE_API_KEY ?? "").trim();
  const empty: FetchJoobleResult = {
    jobs: [],
    queriesMade: 0,
    seen: 0,
    skipped: 0,
    discardedPages: 0,
    disabled: true,
    stoppedByStatus: null,
    stoppedByError: null,
  };
  if (!apiKey) return empty;

  const cap = Math.min(
    Math.max(0, Math.floor(options.maxQueries ?? JOOBLE_QUERIES_PER_RUN)),
    JOOBLE_DAILY_QUERY_CAP,
  );
  const queries = (options.queries ?? planJoobleQueries({ maxQueries: cap })).slice(0, cap);
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.baseUrl ?? JOOBLE_BASE_URL}/${encodeURIComponent(apiKey)}`;
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
    "user-agent": options.userAgent ?? SOURCE_USER_AGENT_BASE,
  };

  const byId = new Map<string, RawJob>();
  const result: FetchJoobleResult = { ...empty, disabled: false };
  for (const q of queries) {
    result.queriesMade++;
    let res: Response;
    try {
      res = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ keywords: q.keywords, location: JOOBLE_LOCATION, page: 1 }),
      });
    } catch (e) {
      // El mensaje de un fallo de red puede traer la URL (con la clave): solo el código cerrado.
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
    const items = parseJooblePage(body);
    if (!items) {
      result.discardedPages++;
      continue;
    }
    result.seen += items.length;
    for (const item of items) {
      const raw = mapJoobleJob(item);
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
