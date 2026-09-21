import type { Db } from "@job-search-os/db";
import {
  cachedRouteSource,
  createDemoLlm,
  createLlmClient,
  createProviderRegistry,
  drizzleCallSink,
  drizzleRouteSource,
  type LlmClient,
  type Logger,
} from "@job-search-os/adapters";

/**
 * Cliente LLM del lado servidor (cron de evaluación y evaluación inmediata al pegar JD).
 * LLM_DEMO=1 (previews sin key y e2e): evaluaciones falsas con model = "fake", badge DEMO en la UI.
 */
export function serviceLlm(db: Db, logger: Logger): LlmClient {
  return process.env.LLM_DEMO === "1"
    ? createDemoLlm({ calls: drizzleCallSink(db) })
    : createLlmClient({
        routes: cachedRouteSource(drizzleRouteSource(db)),
        calls: drizzleCallSink(db),
        providers: createProviderRegistry(),
        logger,
      });
}
