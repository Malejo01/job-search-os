import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";

/**
 * Lo del header que sale de `profiles` en una sola consulta (R26-05): el nombre del avatar (C7-5) y la
 * versión del recorrido de primer uso que la persona ya vio. El layout ya leía el nombre; así el primer uso
 * en la cuenta no suma una consulta a cada pantalla.
 *
 * Falla cerrado hacia «no visto»: sin perfil, o si la consulta rompe, `primerUsoVisto` es null y el
 * recorrido se muestra de nuevo (el navegador igual guarda lo suyo). Si la columna todavía no existe (la
 * migración se aplica después del deploy), se cae a leer solo el nombre y el layout no se rompe.
 */
export type HeaderProfile = { name: string | null; primerUsoVisto: string | null };

export async function getHeaderProfile(userId: string): Promise<HeaderProfile> {
  try {
    const [row] = await withUser(userId, (tx) =>
      tx
        .select({ name: s.profiles.displayName, primerUsoVisto: s.profiles.primerUsoVisto })
        .from(s.profiles)
        .where(eq(s.profiles.userId, userId))
        .limit(1),
    );
    return { name: row?.name ?? null, primerUsoVisto: row?.primerUsoVisto ?? null };
  } catch {
    try {
      const [row] = await withUser(userId, (tx) =>
        tx
          .select({ name: s.profiles.displayName })
          .from(s.profiles)
          .where(eq(s.profiles.userId, userId))
          .limit(1),
      );
      return { name: row?.name ?? null, primerUsoVisto: null };
    } catch {
      return { name: null, primerUsoVisto: null };
    }
  }
}

/**
 * Deja guardado en la cuenta que la persona ya vio el recorrido de esa versión. Solo la propia fila
 * (`user_id` de la sesión, y la policy de `profiles` lo exige también). Sin perfil todavía (onboarding) no
 * hay fila que actualizar: devuelve `false` y el navegador es el que recuerda.
 */
/**
 * Vuelve a dejar el recorrido como «no visto» en la cuenta (R26-03: «Abrir» el primer uso desde `/recorrido`).
 * Solo la propia fila, igual que `savePrimerUsoVisto`.
 */
export async function resetPrimerUsoVisto(userId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .update(s.profiles)
      .set({ primerUsoVisto: null })
      .where(eq(s.profiles.userId, userId))
      .returning({ userId: s.profiles.userId }),
  );
  return rows.length > 0;
}

export async function savePrimerUsoVisto(userId: string, version: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .update(s.profiles)
      .set({ primerUsoVisto: version })
      .where(eq(s.profiles.userId, userId))
      .returning({ userId: s.profiles.userId }),
  );
  return rows.length > 0;
}
