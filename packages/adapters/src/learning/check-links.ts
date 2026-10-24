/**
 * Verificador de links del catálogo de aprendizaje (diseño §2). Un HEAD a una URL que ya tenemos
 * guardada: no recorre sitios, no lee contenido y no guarda nada de la respuesta, solo un código
 * cerrado. No toca la base ni loguea URLs. Falla cerrado: ante la duda, `error`, nunca `ok`.
 */
import {
  classifyLinkCheck,
  isCheckableUrl,
  MAX_REDIRECT_HOPS,
  sameSite,
  type LinkStatus,
  type LinkStep,
} from "@job-search-os/pipeline";
import { sourceUserAgent } from "../sources/user-agent";

export type CheckLinkOptions = {
  fetchImpl?: typeof fetch;
  userAgent?: string;
  timeoutMs?: number;
};

/**
 * `resolvedUrl` sale de un `Location` remoto: aunque pasó `isCheckableUrl`, es dato no confiable.
 * Quien lo guarde lo trata como sugerencia para que la revise una persona, nunca como reemplazo
 * automático de `url`.
 */
export type CheckLinkResult = { status: LinkStatus; resolvedUrl: string | null };

const ERROR_RESULT: CheckLinkResult = { status: "error", resolvedUrl: null };

/** Host sin `www.` + ruta sin la barra final: http a https, `www` o la barra no son "otra ruta". */
function routeKey(url: string): string {
  const u = new URL(url);
  return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
}

async function request(
  url: string,
  method: "HEAD" | "GET",
  opts: Required<CheckLinkOptions>,
): Promise<{ status: number; location: string | null } | { failure: "timeout" | "network" }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const headers: Record<string, string> = {
      "User-Agent": opts.userAgent,
      Accept: "text/html",
    };
    if (method === "GET") headers["Range"] = "bytes=0-0";
    const res = await opts.fetchImpl(url, {
      method,
      redirect: "manual",
      headers,
      signal: controller.signal,
    });
    // Nunca se lee el cuerpo: se descarta
    try {
      await res.body?.cancel();
    } catch {
      /* el cuerpo ya estaba cerrado */
    }
    return { status: res.status, location: res.headers.get("location") };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { failure: aborted || controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkLearningLink(
  url: string,
  options: CheckLinkOptions = {},
): Promise<CheckLinkResult> {
  const opts: Required<CheckLinkOptions> = {
    fetchImpl: options.fetchImpl ?? fetch,
    userAgent: options.userAgent ?? sourceUserAgent(),
    timeoutMs: options.timeoutMs ?? 8000,
  };
  if (!isCheckableUrl(url)) return ERROR_RESULT;

  const steps: LinkStep[] = [];
  let current = url;
  let hops = 0;
  let method: "HEAD" | "GET" = "HEAD";
  let usedGet = false;

  // Cada vuelta hace un pedido; el tope de saltos y el de GET acotan el bucle
  for (let i = 0; i < MAX_REDIRECT_HOPS + 3; i++) {
    const res = await request(current, method, opts);
    if ("failure" in res) {
      steps.push({ failure: res.failure });
      return { status: classifyLinkCheck(steps, false), resolvedUrl: null };
    }
    if (res.status >= 300 && res.status < 400) {
      steps.push({ status: res.status });
      hops += 1;
      if (hops > MAX_REDIRECT_HOPS) {
        return {
          status: classifyLinkCheck([...steps, { failure: "too_many_redirects" }], true),
          resolvedUrl: null,
        };
      }
      let next: string;
      try {
        next = new URL(res.location ?? "", current).href;
      } catch {
        return ERROR_RESULT;
      }
      if (!res.location || !isCheckableUrl(next)) {
        return {
          status: classifyLinkCheck([...steps, { failure: "unsafe_url" }], true),
          resolvedUrl: null,
        };
      }
      // A otro dominio no se sigue (ver `sameSite`): no se sabe si vive, y no se castiga
      if (!sameSite(next, current)) return { status: "blocked", resolvedUrl: null };
      current = next;
      method = "HEAD";
      continue;
    }
    if ((res.status === 405 || res.status === 501) && method === "HEAD" && !usedGet) {
      method = "GET"; // un único GET de un byte por verificación
      usedGet = true;
      continue;
    }
    steps.push({ status: res.status });
    const otherRoute = routeKey(current) !== routeKey(url);
    const status = classifyLinkCheck(steps, otherRoute);
    return { status, resolvedUrl: status === "moved" ? current : null };
  }
  return ERROR_RESULT;
}

export type CheckLinkItem = { id: string; url: string; checkMode: "auto" | "manual" };

export type CheckLinksOptions = CheckLinkOptions & {
  max?: number;
  budgetMs?: number;
  delayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type CheckLinksResult = {
  results: { id: string; status: LinkStatus; resolvedUrl: string | null }[];
  counts: Record<LinkStatus, number>;
  /** true si quedaron links sin revisar por el tope o el presupuesto. */
  truncated: boolean;
};

/**
 * En serie, con pausa entre pedidos. Los `manual` dan `skipped` sin pedido y no gastan el tope.
 * Devuelve solo ids, códigos y cantidades: nada de URLs ni de la respuesta.
 */
export async function checkLearningLinks(
  items: readonly CheckLinkItem[],
  options: CheckLinksOptions = {},
): Promise<CheckLinksResult> {
  const max = options.max ?? 100;
  const budgetMs = options.budgetMs ?? 40_000;
  const delayMs = options.delayMs ?? 300;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();

  const results: CheckLinksResult["results"] = [];
  const counts: Record<LinkStatus, number> = {
    ok: 0,
    moved: 0,
    gone: 0,
    blocked: 0,
    error: 0,
    skipped: 0,
  };
  let truncated = false;
  let checked = 0;

  for (const item of items) {
    if (item.checkMode === "manual") {
      results.push({ id: item.id, status: "skipped", resolvedUrl: null });
      counts.skipped += 1;
      continue;
    }
    if (checked >= max) {
      truncated = true;
      break;
    }
    if (checked > 0) await sleep(delayMs);
    if (now() - start >= budgetMs) {
      truncated = true;
      break;
    }
    const r = await checkLearningLink(item.url, options);
    checked += 1;
    results.push({ id: item.id, status: r.status, resolvedUrl: r.resolvedUrl });
    counts[r.status] += 1;
  }
  return { results, counts, truncated };
}
