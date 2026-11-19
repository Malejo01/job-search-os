"use server";

import {
  AUTH_UNVERIFIED_REASON,
  createLogger,
  pgBlobStorage,
  processHeldInbound,
  type HeldInboundResult,
} from "@job-search-os/adapters";
import { createDb, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { withUser } from "../../../lib/db";
import { isUuid } from "../../../lib/ids";
import { requireActiveUserId } from "../../../lib/session";

/**
 * «Procesar igual» de un email retenido por falta de autenticación (INBOUND_DMARC_MODE=enforce).
 * La pertenencia se comprueba con el rol de la app (RLS): si el email no es de esta persona o no está
 * retenido, no pasa nada. Solo después se procesa con la conexión de servicio, pasando el `userId` de la
 * sesión (nunca uno que venga del formulario). No suma consultas a ninguna página.
 */
export async function processHeldAction(formData: FormData): Promise<void> {
  const userId = await requireActiveUserId();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) return;

  const owned = await withUser(userId, (tx) =>
    tx
      .select({ id: s.inboundEmails.id })
      .from(s.inboundEmails)
      .where(and(eq(s.inboundEmails.id, id), eq(s.inboundEmails.error, AUTH_UNVERIFIED_REASON)))
      .limit(1),
  );
  if (owned.length === 0) return;

  let result: HeldInboundResult;
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    result = await processHeldInbound(id, userId, {
      db: conn.db,
      storage: pgBlobStorage(conn.db),
      logger: createLogger({ user_id: userId }),
    });
  } finally {
    await conn.close();
  }
  revalidatePath("/inbox");
  revalidatePath(`/inbox/${id}`);
  redirect(result.ok ? `/inbox/${result.inboundId}` : `/inbox/${id}`);
}
