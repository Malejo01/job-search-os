import { schema, type Db } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { THINKING_LEVELS, type RouteConfig, type RouteSource, type ThinkingLevel } from "./types";

/** Valida `model_routing.thinking_level`; un valor desconocido se ignora con null (default del proveedor). */
export function parseThinkingLevel(raw: string | null | undefined): ThinkingLevel | null {
  return (THINKING_LEVELS as readonly string[]).includes(raw ?? "") ? (raw as ThinkingLevel) : null;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Lee `model_routing` (ARCHITECTURE §6). Nunca hardcodea un modelo. */
export function drizzleRouteSource(db: Db): RouteSource {
  return {
    async getRoute(task) {
      const [row] = await db
        .select()
        .from(schema.modelRouting)
        .where(eq(schema.modelRouting.task, task))
        .limit(1);
      if (!row) return null;
      return {
        task: row.task,
        provider: row.provider,
        model: row.model,
        fallbackModel: row.fallbackModel,
        temperature: row.temperature ?? 0,
        maxTokens: row.maxTokens ?? 2048,
        thinkingLevel: parseThinkingLevel(row.thinkingLevel),
        inputUsdPerMtok: row.inputUsdPerMtok,
        outputUsdPerMtok: row.outputUsdPerMtok,
        fallbackInputUsdPerMtok: row.fallbackInputUsdPerMtok,
        fallbackOutputUsdPerMtok: row.fallbackOutputUsdPerMtok,
      };
    },
  };
}

/** Cache en memoria por tarea (5 min): cambiar de modelo = UPDATE, sin deploy. */
export function cachedRouteSource(
  inner: RouteSource,
  options: { ttlMs?: number; now?: () => number } = {},
): RouteSource {
  const ttl = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { route: RouteConfig | null; expiresAt: number }>();
  return {
    async getRoute(task) {
      const hit = cache.get(task);
      if (hit && hit.expiresAt > now()) return hit.route;
      const route = await inner.getRoute(task);
      cache.set(task, { route, expiresAt: now() + ttl });
      return route;
    },
  };
}

/** Fuente estática (tests, evals con `--model` explícito). */
export function staticRouteSource(routes: RouteConfig[]): RouteSource {
  const byTask = new Map(routes.map((r) => [r.task, r]));
  return { getRoute: async (task) => byTask.get(task) ?? null };
}
