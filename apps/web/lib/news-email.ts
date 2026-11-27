import { createDb, requireDatabaseUrl, schema as s } from "@job-search-os/db";
import { eq, sql } from "drizzle-orm";
import { withUser } from "./db";

/**
 * Preferencia del email de novedades (R32-09), solo servidor. La columna es `profiles.news_email` (por defecto
 * prendida; el envío en sí está detrás de `NEWS_EMAIL`). La persona la cambia desde Ajustes con su sesión (RLS del
 * dueño); la baja del enlace del email va sin sesión por la función `news_email_unsubscribe` (rls/0074), y solo
 * después de verificar la firma del enlace (`verifyNewsUnsubscribe`, en la ruta).
 */

/** ¿Quiere el email? `null` si no se pudo leer (columna sin migrar o sin perfil): la pantalla no muestra nada. */
export async function getNewsEmailPref(userId: string): Promise<boolean | null> {
  try {
    const [row] = await withUser(userId, (tx) =>
      tx
        .select({ on: s.profiles.newsEmail })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1),
    );
    return row ? row.on : null;
  } catch {
    return null;
  }
}

/** Prende o apaga el email para la persona de la sesión. `false` si no tiene perfil. */
export async function setNewsEmailPref(userId: string, on: boolean): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .update(s.profiles)
      .set({ newsEmail: on })
      .where(eq(s.profiles.userId, userId))
      .returning({ userId: s.profiles.userId }),
  );
  return rows.length > 0;
}

/**
 * Baja sin sesión: la ruta ya verificó la firma. Idempotente. `true` si la persona existe. Corre por la función
 * SECURITY DEFINER; no lee nada de la persona ni devuelve nada más.
 */
export async function unsubscribeNewsEmail(userId: string): Promise<boolean> {
  // La función no tiene EXECUTE para la app (rls/0074): solo la conexión de servicio, y la ruta ya verificó el token
  const conn = createDb(requireDatabaseUrl({ purpose: "service" }), { max: 1 });
  try {
    const rows = (await conn.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '5s'`);
      return tx.execute(sql`select public.news_email_unsubscribe(${userId}::uuid) as ok`);
    })) as unknown as { ok: boolean }[];
    return rows[0]?.ok === true;
  } finally {
    await conn.close();
  }
}
