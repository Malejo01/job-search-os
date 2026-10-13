import { inferSeniorityFromTitle, type RawJob } from "@job-search-os/pipeline";
import { htmlToText } from "./getonboard";

/**
 * Remote OK, API pública JSON. Formato documentado, A VERIFICAR contra la fuente real
 * (se escribió sin red; ver docs/sources/remoteok.md):
 * - `GET https://remoteok.com/api` → array. El primer elemento es un aviso legal (sin id/position).
 * - Salarios en USD anuales; 0 = sin dato. Todo aviso es remoto por definición de la fuente.
 * - Atribución exigida, texto del campo `legal` del elemento [0] citado en
 *   ops/rondas/37-38-39/informes/riesgos-fuentes.md (consultado el 2026-10-12): "Please link back
 *   (with follow, and without nofollow!) to the URL on Remote OK and mention Remote OK as a
 *   source" y "Please don't use the Remote OK logo without written permission". Quien muestre
 *   estos avisos debe enlazar a `source.url` con `follow` y decir "Remote OK", sin logo.
 * - `externalId` es el id de la fuente sin prefijo: la unicidad la da `source.kind`.
 */
export const REMOTEOK_BASE_URL = "https://remoteok.com/api";

export type RemoteOkItem = {
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
  /** Solo el elemento legal inicial trae estos campos. */
  legal?: string;
  [key: string]: unknown;
};

const WORLDWIDE = /^(worldwide|anywhere)$/i;

/** Un aviso es válido si tiene id y puesto: el elemento legal inicial no los tiene. */
export function isRemoteOkJob(item: RemoteOkItem): boolean {
  return item.id != null && item.id !== "" && !!item.position?.trim();
}

/** Un item de la API → RawJob. Puro: no hace I/O. */
export function mapRemoteOkJob(item: RemoteOkItem): RawJob {
  const loc = item.location?.trim() ?? "";
  let locationRaw: string;
  let countriesAllowed: string[] | null;
  if (!loc) {
    locationRaw = "Remoto (países no especificados)";
    countriesAllowed = null;
  } else if (WORLDWIDE.test(loc)) {
    locationRaw = `Remoto (${loc})`;
    countriesAllowed = ["*"];
  } else {
    locationRaw = `Remoto (${loc})`;
    countriesAllowed = null;
  }

  const min = item.salary_min && item.salary_min > 0 ? item.salary_min : null;
  const max = item.salary_max && item.salary_max > 0 ? item.salary_max : null;
  const hasSalary = min !== null || max !== null;
  const id = String(item.id);
  const title = (item.position ?? "").trim();
  const posted = item.epoch ? new Date(item.epoch * 1000) : item.date ? new Date(item.date) : null;

  return {
    source: {
      kind: "remoteok",
      name: "Remote OK",
      externalId: id,
      url: item.url ?? item.apply_url ?? null,
      rawRef: null,
      original: { contentType: "application/json", body: JSON.stringify(item) },
    },
    title,
    companyRaw: item.company?.trim() || "desconocida",
    locationRaw,
    countriesAllowed,
    modality: "remoto",
    contractType: null,
    salaryMinUsd: min,
    salaryMaxUsd: max,
    salaryPeriod: hasSalary ? "anual" : null,
    salaryNote: hasSalary ? "USD/año según Remote OK" : null,
    weeklyHours: null,
    candidatesCount: null,
    badges: [],
    jdText: htmlToText(item.description) || null,
    postedAt: posted && !Number.isNaN(posted.getTime()) ? posted : null,
    tags: item.tags ?? [],
    seniority: inferSeniorityFromTitle(title),
    lang: null,
    categories: (item.tags ?? []).map((t) => t.toLowerCase()),
  };
}

export type FetchRemoteOkOptions = {
  /** Solo avisos publicados desde esta fecha (filtro en cliente por `epoch`). */
  since: Date;
  /** Si viene, solo avisos con alguno de estos tags (filtro en cliente, sin distinguir mayúsculas). */
  tags?: readonly string[];
  /** Si viene, se manda como cabecera `user-agent`. */
  userAgent?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
};

export type FetchRemoteOkResult = {
  jobs: RawJob[];
  /** Texto del campo `legal` del elemento [0], si existe (auditoría y `--dry-run`; no se guarda). */
  legal: string | null;
  /** Avisos vistos antes de filtrar (sin contar el elemento legal). */
  seen: number;
  /** Avisos descartados por estructura incompleta (sin id/position o sin epoch válido). */
  skipped: number;
};

/** Una sola llamada; descarta el aviso legal y filtra por fecha y tags en cliente. */
export async function fetchRemoteOkJobs(
  options: FetchRemoteOkOptions,
): Promise<FetchRemoteOkResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl ?? REMOTEOK_BASE_URL;
  const sinceMs = options.since.getTime();
  const wanted = options.tags?.map((t) => t.toLowerCase());

  const headers: Record<string, string> = { accept: "application/json" };
  if (options.userAgent) headers["user-agent"] = options.userAgent;
  const res = await fetchImpl(baseUrl, { headers });
  if (!res.ok) throw new Error(`Remote OK: HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  if (!Array.isArray(body)) throw new Error("Remote OK: la respuesta no es un array");

  // El elemento legal inicial no cuenta; cualquier otro sin id/position o sin epoch válido se saltea
  const all = body as RemoteOkItem[];
  const legalText = all[0]?.legal;
  const legal = typeof legalText === "string" && legalText.trim() ? legalText : null;
  const items = all.filter(isRemoteOkJob);
  let skipped = all.slice(1).filter((i) => !isRemoteOkJob(i)).length;
  const byId = new Map<string, RawJob>();
  for (const item of items) {
    if (typeof item.epoch !== "number" || !Number.isFinite(item.epoch) || item.epoch <= 0) {
      skipped++;
      continue;
    }
    if (item.epoch * 1000 < sinceMs) continue;
    if (wanted && !(item.tags ?? []).some((t) => wanted.includes(t.toLowerCase()))) continue;
    const id = String(item.id);
    if (!byId.has(id)) byId.set(id, mapRemoteOkJob(item));
  }
  return { jobs: [...byId.values()], legal, seen: items.length, skipped };
}
