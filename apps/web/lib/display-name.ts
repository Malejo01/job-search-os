import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { withUser } from "@/lib/db";

/** Nombre del perfil para el avatar del header (C7-5). Sin perfil o si la consulta falla, null. */
export async function getDisplayName(userId: string): Promise<string | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ name: s.profiles.displayName })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  return row?.name ?? null;
}

/**
 * Ciudad y país (ISO-2) del perfil para los chips de Ofertas (R30-05): «En {ciudad}» y «Aceptan
 * {país}». Una sola consulta; lo que no cargó queda null.
 */
export async function getProfilePlace(
  userId: string,
): Promise<{ city: string | null; country: string | null }> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ city: s.profiles.locationCity, country: s.profiles.locationCountry })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  const city = row?.city?.trim();
  const country = row?.country?.trim().toUpperCase();
  return { city: city ? city : null, country: country ? country : null };
}

/** Ciudad del perfil (el chip «En {ciudad}» de Ofertas, C10); null si no la cargó. */
export async function getProfileCity(userId: string): Promise<string | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .select({ city: s.profiles.locationCity })
      .from(s.profiles)
      .where(eq(s.profiles.userId, userId))
      .limit(1),
  );
  const city = row?.city?.trim();
  return city ? city : null;
}
