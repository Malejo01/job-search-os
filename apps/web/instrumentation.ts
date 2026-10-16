import { buildRequestErrorLog } from "@/lib/request-error-log";

type ReqInfo = { path: string; method: string };
type ErrCtx = { routeType: string; routerKind: string; routePath: string };

/**
 * Errores no manejados de requests (Next 15). Loguea solo una lista blanca (ver request-error-log.ts).
 * El logger se importa dinámico y solo en node: Next compila este archivo también para edge.
 */
export async function onRequestError(
  error: unknown,
  request: ReqInfo,
  context: ErrCtx,
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { createLogger } = await import("@job-search-os/adapters");
    createLogger({ route: "request-error" }).error(
      buildRequestErrorLog(error, request, context),
      "error de request no manejado",
    );
  }
}
