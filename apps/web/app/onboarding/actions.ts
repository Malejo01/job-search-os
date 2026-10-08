"use server";

import {
  createLogger,
  parseEnabledSources,
  runExtraSourcesIngest,
  runGetOnBoardIngest,
  safeDbError,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl } from "@job-search-os/db";
import { parseOnboarding } from "@job-search-os/pipeline";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { upgradeLegacyInboundAddress } from "@/lib/inbound-address";
import { completeOnboarding, isOnboardingComplete } from "@/lib/onboarding";
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
  const saved = await completeOnboarding(userId, parsed.value);
  if (!saved) redirect("/onboarding?error=perfil");
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
  redirect("/onboarding/asistente");
}

/**
 * Ingesta de Get on Board y de las fuentes de INGEST_EXTRA_SOURCES solo para este usuario, después
 * de responder. Mismas funciones y mismo tope de páginas que el cron; las evaluaciones que encola
 * respetan el tope diario por usuario. Si falla, se loguea y el usuario no se entera.
 */
function scheduleFirstIngest(userId: string): void {
  after(async () => {
    const logger = createLogger({ user_id: userId, task: "first_ingest" });
    let conn: ReturnType<typeof createDb> | null = null;
    try {
      conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 2 });
      const { db } = conn;
      try {
        await runGetOnBoardIngest({ db, logger, userId, sinceHours: 24 });
      } catch (e) {
        logger.error({ err: safeDbError(e) }, "primera ingesta: Get on Board falló");
      }
      const { enabled } = parseEnabledSources(process.env.INGEST_EXTRA_SOURCES);
      if (enabled.length > 0) {
        try {
          await runExtraSourcesIngest({ db, logger, enabled, userId, sinceHours: 24 });
        } catch (e) {
          logger.error({ err: safeDbError(e) }, "primera ingesta: fuentes extra fallaron");
        }
      }
    } catch (e) {
      logger.error({ err: safeDbError(e) }, "primera ingesta no pudo arrancar");
    } finally {
      await conn?.close().catch(() => {});
    }
  });
}
