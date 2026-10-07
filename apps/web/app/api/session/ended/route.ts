import { schema as s } from "@job-search-os/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getAppDb } from "@/lib/db";

/**
 * Cierra una sesión cuyo usuario ya no existe (cuenta borrada, JS-092) y manda a /login.
 * Solo cierra si el usuario de la sesión realmente no existe en `users`: si existe, no hay nada
 * que cerrar y vuelve a la app (así nadie puede deslogear a otro con un link). Sin sesión, a /login.
 * Sin esto, el middleware vería un JWT vigente en /login y volvería a redirigir a la app.
 */
export async function GET(): Promise<Response> {
  const id = (await auth())?.user?.id;
  if (!id) redirect("/login");
  const [user] = await getAppDb()
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.id, id))
    .limit(1);
  if (user) redirect("/jobs");
  await signOut({ redirectTo: "/login" }); // lanza el redirect de Next
  return new Response(null, { status: 204 });
}
