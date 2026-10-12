"use server";

import {
  assignPoolToUser,
  createLogger,
  parseEnabledSources,
  parsePoolSources,
  recomputeMarketForUser,
  runExtraSourcesIngest,
  runGetOnBoardIngest,
  safeDbError,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { parseOnboarding, parsePoolLimits } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { upgradeLegacyInboundAddress } from "@/lib/inbound-address";
import { completeOnboarding, isOnboardingComplete } from "@/lib/onboarding";
import { reassignForRoleChange } from "@/lib/pool-reassign";
import { requireUserId } from "@/lib/session";

/**
 * Guarda el onboarding (B2). Valida con Zod (parseOnboarding); si falla vuelve al formulario con
 * el nombre del campo, nunca con el valor. El usuario sale de la sesión, no del formulario.
 */
export async function saveOnboardingAction(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const raw: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string") raw[k] = v;
  const parsed = parseOnboarding(raw);
  if (!parsed.ok) redirect(`/onboarding?error=${encodeURIComponent(parsed.field)}`);
  // Solo la primera vez dispara la ingesta: un POST repetido a la acción no la repite
  const wasComplete = await isOnboardingComplete(userId);
  const { saved, roleChanged } = await completeOnboarding(userId, parsed.value);
  if (!saved) redirect("/onboarding?error=perfil");
  // Reenvío con otro puesto y con evaluaciones hechas: reasigna (sin actividad lo cubre Mis skills)
  if (wasComplete && roleChanged) await reassignForRoleChange(userId, { onlyWithActivity: true });
  // JS-095: la dirección derivada del id se cambia por una aleatoria (si ya lo es, no se toca)
  // Es accesorio: si falla, el onboarding sigue (la dirección se puede rotar desde Ajustes)
  try {
    await upgradeLegacyInboundAddress(userId);
  } catch {
    createLogger({ user_id: userId, task: "inbound_address" }).error(
      "no se pudo asignar la dirección de email entrante",
    );
  }
  // Así ve ofertas sin esperar al cron; si el onboarding ya estaba completo no se repite
  if (!wasComplete) scheduleFirstIngest(userId);
  redirect("/onboarding/skills");
}

/**
 * Primeras ofertas de la persona, después de responder (el usuario no espera ni se entera si algo
 * falla). En orden:
 * 1. Si `getonboard` no está en POOL_SOURCES (el pool todavía está apagado), la ingesta por usuario
 *    de siempre, para no dejar a nadie sin ofertas; y las fuentes de INGEST_EXTRA_SOURCES.
 * 2. Asignación desde el pool global (`assignPoolToUser`): asigna, no encola ni llama al modelo.
 * 3. Primer mercado y plan (sin LLM).
 * Acá no se evalúa: la primera evaluación pasa a la salida de Mis skills (ronda 41, decisión 1),
 * cuando la persona ya cargó sus niveles; así esa salida puede reemplazar las ofertas no tocadas
 * con un ranking que use sus skills. Si abandona antes, igual tiene ofertas en /jobs y el cron del
 * día las evalúa con su tope.
 */
function scheduleFirstIngest(userId: string): void {
  after(async () => {
    const logger = createLogger({ user_id: userId, task: "first_ingest" });
    let conn: ReturnType<typeof createDb> | null = null;
    try {
      conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
      const { db } = conn;
      const pools = parsePoolSources(process.env.POOL_SOURCES);
      if (!pools.enabled.includes("getonboard")) {
        try {
          await runGetOnBoardIngest({ db, logger, userId, sinceHours: 24 });
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: Get on Board falló");
        }
      }
      const { enabled } = parseEnabledSources(process.env.INGEST_EXTRA_SOURCES);
      if (enabled.length > 0) {
        try {
          await runExtraSourcesIngest({ db, logger, enabled, userId, sinceHours: 24 });
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: fuentes extra fallaron");
        }
      }
      // Ofertas del pool global para esta persona, sin evaluar (enqueueTop: 0)
      try {
        const { limits, invalid } = parsePoolLimits(process.env);
        if (invalid.length > 0) {
          logger.warn({ invalid }, "topes del pool inválidos: se usa el valor por defecto");
        }
        const assigned = await assignPoolToUser(db, userId, {
          limit: limits.firstAssignLimit,
          enqueueTop: 0,
          // Un segundo envío no asigna de nuevo: descuenta lo asignado en las últimas 24 h
          deductLast24h: true,
          logger,
        });
        logger.info({ assigned: assigned.assigned }, "primera ingesta: pool asignado");
      } catch (e) {
        logger.error({ err: safeDbError(e) }, "primera ingesta: la asignación del pool falló");
      }
      // Con las ofertas ya ingeridas: primer mercado y plan de la persona (sin LLM)
      try {
        await recomputeMarketForUser(db, { userId, inputsChanged: true });
      } catch (e) {
        logger.error({ err: safeDbError(e) }, "primera ingesta: el recálculo de mercado falló");
      }
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "primera ingesta no pudo arrancar");
    } finally {
      await conn?.close().catch(() => {});
    }
  });
}
