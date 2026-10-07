import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { getAppDb } from "./db";

/**
 * users.id de la sesión actual; sin sesión redirige a /login (el middleware ya lo hace, esto es el cinturón).
 * Falla cerrado si el usuario ya no existe (cuenta borrada, JS-092): el JWT dura 30 días y no hay FK
 * a `users`, así que sin este chequeo una sesión vieja podría crear filas huérfanas. El borrado de la
 * cookie lo hace /api/session/ended (no se puede desde un render y /login con JWT vigente rebotaría).
 * Con `cache` el chequeo corre una vez por request aunque lo llamen el layout y la página.
 */
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect("/login");
  const [user] = await getAppDb()
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.id, id))
    .limit(1);
  if (!user) redirect("/api/session/ended");
  return id;
});
