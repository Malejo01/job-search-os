import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { withUser } from "./db";
import { TERMS_VERSION } from "./terms";

/**
 * Re-aceptación de los términos (ronda 83). Lee y escribe la fila propia con withUser: users_read y
 * users_self_update (rls/0000) dejan ver y cambiar solo `id = auth.uid()`.
 */

/**
 * ¿La persona tiene que aceptar los términos vigentes? Null (cuenta anterior al versionado) cuenta como
 * "sí". Con `cache` corre una consulta por request aunque la llamen el layout y la página.
 */
export const needsTermsAcceptance = cache(async (userId: string): Promise<boolean> => {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ termsVersion: s.users.termsVersion })
      .from(s.users)
      .where(eq(s.users.id, userId))
      .limit(1),
  );
  return row?.termsVersion !== TERMS_VERSION;
});

/** Deja constancia de la aceptación de la versión vigente: versión y fecha en la propia fila. */
export async function acceptCurrentTerms(userId: string): Promise<void> {
  await withUser(userId, (tx) =>
    tx
      .update(s.users)
      .set({ termsVersion: TERMS_VERSION, termsAcceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.users.id, userId)),
  );
}
