import {
  isPoolRemoteCandidate,
  type Modality,
  type RawJob,
  type SourceKind,
} from "@job-search-os/pipeline";
import { htmlToText } from "./getonboard";
import { sourceErrorCode, type SourceErrorCode } from "./error-code";
import { withSignal } from "./with-signal";

/**
 * Piezas comunes de los ATS públicos (Greenhouse, Lever, Ashby; ronda 47). Cada proveedor tiene
 * una API de lectura sin credenciales por board (la empresa publica sus avisos ahí). La lista de
 * boards la mantiene Mauro en `ats_boards`; acá solo se valida el token, se arma la URL y se
 * hace el GET con tope de tamaño, timeout y un reintento. Ver docs/adr/018-fuentes-pool-ats.md.
 */
export const ATS_PROVIDERS = ["greenhouse", "lever", "ashby", "teamtailor"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];

/** Estado cerrado de un board: lo que se guarda en `ats_boards.last_status`. */
export type AtsBoardStatus = "ok" | "not_found" | "invalid_token" | "too_large" | SourceErrorCode;

const TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/i;

/** Slug de board: letras, números, `.`, `_` y `-`; máx. 100. Nada de `/`, `:`, `?`, `#` ni `@`. */
export function isValidAtsToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token) && !token.includes("..");
}

export class AtsBoardError extends Error {
  constructor(
    readonly status: Exclude<AtsBoardStatus, "ok">,
    message: string,
  ) {
    super(message);
    this.name = "AtsBoardError";
  }
}

/** Etiqueta DNS (Teamtailor la usa de subdominio): `[a-z0-9-]`, sin guion al borde, máx. 63. */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * URL del board. SOLO con el token validado y codificado; el host sale de una tabla fija. `region`
 * existe únicamente para Lever (`"eu"`) y Teamtailor (`"na"`); cualquier otra combinación es un
 * error (anti-SSRF). En Teamtailor el token va en el subdominio: además tiene que ser una etiqueta
 * DNS válida.
 */
export function atsBoardUrl(provider: AtsProvider, token: string, region?: string | null): string {
  if (!isValidAtsToken(token)) throw new AtsBoardError("invalid_token", "token inválido");
  const hasRegion = region !== undefined && region !== null && region !== "";
  if (
    hasRegion &&
    !((provider === "lever" && region === "eu") || (provider === "teamtailor" && region === "na"))
  ) {
    throw new AtsBoardError("invalid_token", "región inválida");
  }
  if (provider === "teamtailor" && !DNS_LABEL_RE.test(token)) {
    throw new AtsBoardError("invalid_token", "token inválido");
  }
  const t = encodeURIComponent(token);
  switch (provider) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
    case "lever":
      return `https://${hasRegion ? "api.eu.lever.co" : "api.lever.co"}/v0/postings/${t}?mode=json&limit=${LEVER_API_LIMIT}`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`;
    case "teamtailor":
      // Un único GET al feed, sin paginación (`offset`/`per_page`): es lo menos invasivo.
      return `https://${t}${hasRegion ? ".na" : ""}.teamtailor.com/jobs.rss`;
    default:
      throw new AtsBoardError("invalid_token", "proveedor inválido");
  }
}

export const ATS_REQUEST_TIMEOUT_MS = 8_000;
/** 15 MB: Greenhouse con `content=true` en boards grandes pasa de los 5 MB. */
export const ATS_MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_RETRY_AFTER_MS = 10_000;
const DEFAULT_BACKOFF_MS = 1_000;

export type AtsRequestOptions = {
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Para tests: reemplaza la espera del backoff. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Ms que le quedan a la fuente (deadline): topea el timeout y decide si vale esperar el backoff. */
  timeLeftMs?: () => number;
};

function retryDelayMs(res: Response): number {
  const raw = res.headers.get("retry-after");
  const seconds = raw && /^\d{1,6}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  return DEFAULT_BACKOFF_MS;
}

/**
 * Lee el cuerpo como stream contando BYTES: al pasar el tope cancela la lectura y falla cerrado
 * (`too_large`) sin haber bajado todo. Si la señal se aborta a mitad de la lectura, también corta.
 */
async function readCapped(res: Response, signal: AbortSignal): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const onAbort = new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error("timeout de la fuente"));
        void reader.cancel().catch(() => {});
      },
      { once: true },
    );
  });
  onAbort.catch(() => {});
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), onAbort]);
    if (done) {
      if (signal.aborted) throw new Error("timeout de la fuente");
      break;
    }
    total += value.byteLength;
    if (total > ATS_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new AtsBoardError("too_large", "respuesta demasiado grande");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * GET JSON con `User-Agent`, 8 s por request, un reintento ante 429 o 5xx (respeta `Retry-After`
 * hasta 10 s, y no duerme si no entra en `timeLeftMs`) y tope de 5 MB leídos en bytes. 404 → `not_found`; otros 4xx → `http_4xx`. Nunca devuelve el
 * mensaje ni el cuerpo del error: lanza `AtsBoardError` con un estado cerrado.
 */
export async function atsGetJson(url: string, options: AtsRequestOptions = {}): Promise<unknown> {
  const body = await atsGetBody(url, options, "application/json");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new AtsBoardError("parse", "respuesta inesperada");
  }
}

/** Igual que `atsGetJson` (mismo tope, timeout, reintento y errores cerrados), pero devuelve el texto (RSS/XML). */
export async function atsGetText(url: string, options: AtsRequestOptions = {}): Promise<string> {
  return atsGetBody(url, options, "application/rss+xml, application/xml, text/xml");
}

async function atsGetBody(
  url: string,
  options: AtsRequestOptions,
  accept: string,
): Promise<string> {
  const base = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers: Record<string, string> = { accept };
  if (options.userAgent) headers["user-agent"] = options.userAgent;

  for (let attempt = 0; attempt < 2; attempt++) {
    // Una sola señal por intento: corta el fetch y también la lectura del cuerpo. Nunca pasa de lo
    // que le queda a la fuente.
    const left = options.timeLeftMs?.();
    const signal = AbortSignal.timeout(
      Math.max(1, Math.min(options.timeoutMs ?? ATS_REQUEST_TIMEOUT_MS, left ?? Infinity)),
    );
    const f = withSignal(base, signal);
    const res = await f(url, { headers, redirect: "error", signal });
    if (res.status === 404) throw new AtsBoardError("not_found", "HTTP 404");
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      const delay = retryDelayMs(res);
      await res.body?.cancel().catch(() => {});
      // Si la espera no entra en lo que le queda a la fuente, el board falla con su código.
      const remaining = options.timeLeftMs?.();
      if (remaining !== undefined && delay >= remaining) throw new Error(`HTTP ${res.status}`);
      await sleep(delay);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > ATS_MAX_RESPONSE_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new AtsBoardError("too_large", "respuesta demasiado grande");
    }
    return readCapped(res, signal);
  }
  throw new Error("HTTP 429");
}

/** Estado cerrado de cualquier error de un board. */
export function atsStatusOf(e: unknown): Exclude<AtsBoardStatus, "ok"> {
  if (e instanceof AtsBoardError) return e.status;
  return sourceErrorCode(e);
}

/**
 * Fallo permanente de un board (slug mal cargado o que ya no existe): se registra en `last_status`,
 * pero no es un problema de la fuente ni impide que quede `ok`. Los demás (timeout, 429, 5xx, red,
 * `too_large`, parse) son transitorios y dejan la fuente `partial`.
 */
export function isPermanentBoardStatus(status: AtsBoardStatus): boolean {
  return status === "not_found" || status === "invalid_token";
}

/** Código del nivel fuente (`PoolErrorCode`) para el estado de un board. */
export function atsSourceError(status: Exclude<AtsBoardStatus, "ok">): SourceErrorCode {
  switch (status) {
    case "not_found":
      return "http_4xx";
    case "too_large":
      return "parse";
    case "invalid_token":
      return "unknown";
    default:
      return status;
  }
}

export type AtsBoardOptions = {
  token: string;
  /** Solo Lever: `"eu"`. Solo Teamtailor: `"na"`. */
  region?: string | null;
  /** `company_name` del board: va a `companyRaw`. */
  companyName: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Ms que le quedan a la fuente; ver `AtsRequestOptions`. */
  timeLeftMs?: () => number;
};

export type AtsBoardResult = {
  jobs: RawJob[];
  /** Descartados por no ser remotos (`isPoolRemoteCandidate`). */
  filteredNonRemote: number;
  /** Descartados por estructura incompleta, no listados o sin fecha válida. */
  skipped: number;
  /** Solo Ashby: avisos con `isListed === false`. */
  unlisted?: number;
  /** Items crudos vistos, para el informe de campos del `--dry-run`. */
  seen: number;
  /** `ok`, o `not_found` si el board no existe (sin excepción). */
  status: "ok" | "not_found";
  /** Remotos que quedaron afuera por `ATS_MAX_JOBS_PER_BOARD` (0 si ninguno). */
  truncated: number;
  /** Solo Teamtailor: el feed trajo exactamente 100 items (su tope por defecto), puede estar cortado. */
  feedMaybeTruncated?: true;
};

/** Items por defecto del feed RSS de Teamtailor: con exactamente esa cantidad, puede haber más. */
export const TEAMTAILOR_FEED_DEFAULT_LIMIT = 100;

/** Tope de avisos por board y por corrida: quedan los más recientes. */
export const ATS_MAX_JOBS_PER_BOARD = 200;

/** `limit` del pedido a Lever (la API lo soporta; Greenhouse y Ashby no): igual al tope por board. */
export const LEVER_API_LIMIT = ATS_MAX_JOBS_PER_BOARD;

export const emptyBoardResult = (status: "ok" | "not_found"): AtsBoardResult => ({
  jobs: [],
  filteredNonRemote: 0,
  skipped: 0,
  seen: 0,
  status,
  truncated: 0,
});

/** Texto plano desde HTML que puede venir con las etiquetas escapadas (`&lt;p&gt;`), como Greenhouse. */
export function atsHtmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const once = htmlToText(html);
  // Escapado: la primera pasada deja `<p>…</p>` como texto; la segunda lo quita.
  return /<\/?[a-z][^>]*>/i.test(once) ? htmlToText(once) : once;
}

export function modalityOfWorkplace(
  workplaceType: string | null | undefined,
  isRemote?: boolean | null,
  locationText?: string | null,
): Modality {
  const w = (workplaceType ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (w === "remote") return "remoto";
  if (w === "hybrid") return "hibrido";
  if (w === "onsite") return "presencial";
  if (w === "" || w === "unspecified") {
    if (isRemote === true) return "remoto";
    if (locationText && /\bremot[eo]\b/i.test(locationText)) return "remoto";
  }
  return "desconocida";
}

const WORLDWIDE = /\b(anywhere|worldwide)\b/i;

/** Solo "Anywhere"/"Worldwide" dan `["*"]`; lo demás queda null (el prefiltro marca el riesgo). */
export function countriesFromLocation(locationText: string | null | undefined): string[] | null {
  return locationText && WORLDWIDE.test(locationText) ? ["*"] : null;
}

export function salaryPeriodOf(
  interval: string | null | undefined,
): "mensual" | "anual" | "hora" | null {
  const s = (interval ?? "").toLowerCase();
  if (/year|annual|\byr\b/.test(s)) return "anual";
  if (/month/.test(s)) return "mensual";
  if (/hour/.test(s)) return "hora";
  return null;
}

function positive(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

export type AtsSalaryFields = Pick<
  RawJob,
  "salaryMinUsd" | "salaryMaxUsd" | "salaryPeriod" | "salaryNote"
>;

/** Solo USD con período claro llena los números; si no, va a `salaryNote` (D-017). */
export function atsSalary(input: {
  min?: unknown;
  max?: unknown;
  currency?: unknown;
  interval?: unknown;
  sourceName: string;
}): AtsSalaryFields {
  const min = positive(input.min);
  const max = positive(input.max);
  const none: AtsSalaryFields = {
    salaryMinUsd: null,
    salaryMaxUsd: null,
    salaryPeriod: null,
    salaryNote: null,
  };
  if (min === null && max === null) return none;
  const currency =
    typeof input.currency === "string" && input.currency.trim()
      ? input.currency.trim().toUpperCase().slice(0, 8)
      : null;
  const interval = typeof input.interval === "string" ? input.interval.trim() : "";
  const period = salaryPeriodOf(interval);
  if (currency === "USD" && period) {
    return { salaryMinUsd: min, salaryMaxUsd: max, salaryPeriod: period, salaryNote: null };
  }
  const per = interval ? ` (${interval.slice(0, 40)})` : "";
  return {
    ...none,
    salaryNote: `${currency ?? "moneda no indicada"} ${min ?? "?"}–${max ?? "?"}${per} según ${input.sourceName}`,
  };
}

export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d =
    typeof value === "number"
      ? new Date(value)
      : typeof value === "string"
        ? new Date(/^\d{10,13}$/.test(value.trim()) ? Number(value.trim()) : value)
        : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type AtsJobParts = {
  provider: AtsProvider;
  token: string;
  /** Id del aviso en el proveedor. */
  id: string;
  sourceName: string;
  url: string;
  title: string;
  companyName: string;
  locationRaw: string | null;
  modality: Modality;
  contractType?: string | null;
  jdText: string | null;
  postedAt: Date | null;
  categories: string[];
  salary: AtsSalaryFields;
  original: unknown;
};

/** RawJob común a los tres proveedores. `externalId` = `{provider}:{token}:{id}`. */
export function buildAtsRawJob(p: AtsJobParts): RawJob {
  // PROVISORIO (120-a): el enum `source_kind` de la base todavía no tiene "teamtailor", así que
  // `SourceKind` tampoco. Hasta que 120-b agregue el valor, sus avisos llevan "other" (la fuente
  // no se prende antes). El `externalId` conserva el prefijo del proveedor.
  const kind: SourceKind = p.provider === "teamtailor" ? "other" : p.provider;
  return {
    source: {
      kind,
      name: p.sourceName,
      externalId: `${p.provider}:${p.token}:${p.id}`,
      url: p.url,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(p.original) },
    },
    title: p.title,
    companyRaw: p.companyName,
    locationRaw: p.locationRaw,
    countriesAllowed: countriesFromLocation(p.locationRaw),
    modality: p.modality,
    contractType: p.contractType ?? null,
    ...p.salary,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: p.jdText || null,
    postedAt: p.postedAt,
    tags: [],
    seniority: null,
    lang: null,
    categories: [...new Set(p.categories.map((c) => c.trim()).filter(Boolean))],
  };
}

/** Topes de ubicaciones por aviso: una lista enorme no infla `locationRaw` ni el filtro de remotos. */
export const ATS_MAX_LOCATIONS = 20;
export const ATS_MAX_LOCATION_CHARS = 500;

/**
 * Une la ubicación principal con las secundarias, sin repetidos, con "; ". Máximo
 * `ATS_MAX_LOCATIONS` secundarias y `ATS_MAX_LOCATION_CHARS` caracteres. `null` si queda vacío.
 */
export function joinAtsLocations(primary: string, others: readonly string[]): string | null {
  const parts = [primary, ...others.slice(0, ATS_MAX_LOCATIONS)].filter(Boolean);
  return [...new Set(parts)].join("; ").slice(0, ATS_MAX_LOCATION_CHARS) || null;
}

/** Solo http(s): una URL de otro esquema no se guarda como enlace al aviso. */
export function httpUrl(value: unknown): string | null {
  const v = text(value);
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Un aviso mapeado: el RawJob y lo que necesita el filtro de remotos. */
export type AtsMapped =
  | "skip"
  | "unlisted"
  | {
      raw: RawJob;
      remote: {
        locationText: string | null;
        workplaceType: string | null;
        isRemote: boolean | null;
      };
    };

/**
 * Descarga un board y lo pasa por el mismo embudo en los tres proveedores: estructura →
 * (no listado) → remoto → dedup → tope por board (sin ventana de fecha). 404 → `status: "not_found"`, sin excepción;
 * el resto de los fallos lanzan `AtsBoardError` / `HTTP n` (ver `atsStatusOf`).
 */
export async function fetchAtsBoard(
  provider: AtsProvider,
  options: AtsBoardOptions,
  spec: {
    items: (body: unknown) => unknown[] | null;
    map: (item: Record<string, unknown>) => AtsMapped;
    /** `"text"`: el cuerpo llega como texto (RSS) y `items` lo recibe tal cual. Default: JSON. */
    format?: "json" | "text";
  },
): Promise<AtsBoardResult> {
  const url = atsBoardUrl(provider, options.token, options.region);
  let body: unknown;
  try {
    body = spec.format === "text" ? await atsGetText(url, options) : await atsGetJson(url, options);
  } catch (e) {
    if (e instanceof AtsBoardError && e.status === "not_found")
      return emptyBoardResult("not_found");
    throw e;
  }
  const items = spec.items(body);
  if (!items) throw new AtsBoardError("parse", "respuesta inesperada");

  const byId = new Map<string, RawJob>();
  const result = emptyBoardResult("ok");
  result.seen = items.length;
  if (provider === "teamtailor" && items.length === TEAMTAILOR_FEED_DEFAULT_LIMIT) {
    result.feedMaybeTruncated = true;
  }
  let unlisted = 0;
  for (const item of items) {
    const mapped =
      item && typeof item === "object" && !Array.isArray(item)
        ? spec.map(item as Record<string, unknown>)
        : "skip";
    if (mapped === "skip") {
      result.skipped++;
      continue;
    }
    if (mapped === "unlisted") {
      unlisted++;
      continue;
    }
    if (!isPoolRemoteCandidate(mapped.remote)) {
      result.filteredNonRemote++;
      continue;
    }
    const id = mapped.raw.source.externalId!;
    if (!byId.has(id)) byId.set(id, mapped.raw);
  }
  const all = [...byId.values()];
  if (provider === "ashby") result.unlisted = unlisted;
  if (all.length <= ATS_MAX_JOBS_PER_BOARD) {
    result.jobs = all;
    return result;
  }
  // Más recientes primero; sin fecha al final. `sort` es estable: a igual fecha, el orden de la respuesta.
  const time = (j: RawJob) => j.postedAt?.getTime() ?? -Infinity;
  const sorted = all.sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    return ta === tb ? 0 : ta < tb ? 1 : -1;
  });
  result.jobs = sorted.slice(0, ATS_MAX_JOBS_PER_BOARD);
  result.truncated = sorted.length - ATS_MAX_JOBS_PER_BOARD;
  return result;
}
