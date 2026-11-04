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
